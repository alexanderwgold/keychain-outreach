import { createAdminClient } from "../_shared/supabase-client.ts";
import { refreshGoogleToken, googleApiFetch } from "../_shared/google-auth.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { requireSelf } from "../_shared/auth.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

const MIN_EMAILS_REQUIRED = 5;
const MAX_EMAILS_TO_SAMPLE = 40;
const MIN_BODY_LENGTH = 50;

const INTERNAL_DOMAIN = "@keychain.com";

const CALENDAR_PREFIXES = ["accepted:", "declined:", "tentative:"];
const AUTO_REPLY_KEYWORDS = ["out of office", "automatic reply", "auto-reply"];

interface AnalyzeRequest {
  repEmail: string;
}

interface StyleResult {
  toneAndVoice: string;
  openingStyle: string;
  closingAndSignoff: string;
  thingsToAvoid: string;
  examplePhrases: string;
}

function isCalendarResponse(subject: string): boolean {
  const lower = subject.toLowerCase();
  return CALENDAR_PREFIXES.some((p) => lower.startsWith(p));
}

function isAutoReply(subject: string): boolean {
  const lower = subject.toLowerCase();
  return AUTO_REPLY_KEYWORDS.some((k) => lower.includes(k));
}

function isInternalOnly(recipients: string): boolean {
  const list = recipients
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  // Empty recipients list: we don't know, so don't filter out.
  if (list.length === 0) return false;
  return list.every((r) => r.includes(INTERNAL_DOMAIN));
}

/**
 * Decode a Gmail base64url-encoded body as UTF-8 text. Plain `atob` returns
 * a binary string, which corrupts multi-byte UTF-8 sequences (any non-ASCII
 * character). We rebuild bytes first, then run TextDecoder.
 */
function decodeBase64UrlUtf8(data: string): string {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function extractPlainText(payload: Record<string, unknown>): string {
  const parts = (payload.parts as Record<string, unknown>[]) ?? [];

  // Try to find plain text part first
  for (const part of parts) {
    if (part.mimeType === "text/plain" && (part.body as Record<string, unknown>)?.data) {
      const data = (part.body as Record<string, unknown>).data as string;
      return decodeBase64UrlUtf8(data);
    }
  }

  // Fallback to HTML part, strip tags
  for (const part of parts) {
    if (part.mimeType === "text/html" && (part.body as Record<string, unknown>)?.data) {
      const data = (part.body as Record<string, unknown>).data as string;
      const html = decodeBase64UrlUtf8(data);
      return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  // Single-part message (no parts array)
  if ((payload.body as Record<string, unknown>)?.data) {
    const data = (payload.body as Record<string, unknown>).data as string;
    const decoded = decodeBase64UrlUtf8(data);
    if ((payload.mimeType as string)?.includes("html")) {
      return decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return decoded;
  }

  // Nested multipart — recurse into first level
  for (const part of parts) {
    if ((part.parts as unknown[])?.length) {
      const nested = extractPlainText(part);
      if (nested) return nested;
    }
  }

  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: AnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { repEmail } = body;
  if (!repEmail) return jsonResponse({ error: "repEmail required" }, 400);

  const forbid = await requireSelf(req, repEmail);
  if (forbid) return forbid;

  try {
    const client = createAdminClient();

    // Verify rep exists and is active
    const { data: repToken, error: repError } = await client
      .from("rep_tokens")
      .select("rep_email, is_active")
      .eq("rep_email", repEmail)
      .eq("is_active", true)
      .single();

    if (repError || !repToken) {
      return jsonResponse({ error: "Rep not found or inactive" }, 404);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Step 1: Refresh Google token
    const accessToken = await refreshGoogleToken(repEmail, client);

    // Step 2: Search sent emails from last 30 days
    const searchResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}?q=${encodeURIComponent("in:sent newer_than:30d")}&maxResults=500`,
      accessToken
    );

    if (!searchResponse.ok) {
      return jsonResponse({ error: `Gmail search failed: ${searchResponse.status}` }, 502);
    }

    const searchData = await searchResponse.json();
    const messageIds: string[] = (searchData.messages ?? []).map((m: { id: string }) => m.id);

    if (messageIds.length === 0) {
      return jsonResponse({ error: "insufficient_emails", emailsFound: 0 }, 422);
    }

    // Step 3: Fetch metadata for all messages
    interface EmailCandidate {
      messageId: string;
      subject: string;
      to: string;
      bodyLength: number;
      body: string;
    }

    const candidates: EmailCandidate[] = [];

    // Fetch in batches of 20 to avoid overwhelming the API
    for (let i = 0; i < messageIds.length; i += 20) {
      const batch = messageIds.slice(i, i + 20);
      const batchResults = await Promise.all(
        batch.map(async (msgId) => {
          const msgResponse = await googleApiFetch(
            `${GMAIL_MESSAGES_URL}/${msgId}?format=full`,
            accessToken
          );
          if (!msgResponse.ok) return null;
          return msgResponse.json();
        })
      );

      for (const msgData of batchResults) {
        if (!msgData) continue;

        const headers = msgData.payload?.headers ?? [];
        const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? "";
        const to = headers.find((h: { name: string }) => h.name === "To")?.value ?? "";
        const cc = headers.find((h: { name: string }) => h.name === "Cc")?.value ?? "";
        const bcc = headers.find((h: { name: string }) => h.name === "Bcc")?.value ?? "";
        const allRecipients = [to, cc, bcc].filter((v) => v.length > 0).join(",");

        // Filter: skip calendar responses
        if (isCalendarResponse(subject)) continue;
        // Filter: skip auto-replies
        if (isAutoReply(subject)) continue;
        // Filter: skip internal-only emails (check To+Cc+Bcc combined)
        if (isInternalOnly(allRecipients)) continue;

        // Extract body text
        const body = extractPlainText(msgData.payload ?? {});

        // Filter: skip short messages
        if (body.length < MIN_BODY_LENGTH) continue;

        candidates.push({
          messageId: msgData.id,
          subject,
          to,
          bodyLength: body.length,
          body,
        });
      }
    }

    // Step 4: Check minimum threshold
    if (candidates.length < MIN_EMAILS_REQUIRED) {
      return jsonResponse({
        error: "insufficient_emails",
        emailsFound: candidates.length,
      }, 422);
    }

    // Step 5: Sort by body length descending, take top N
    candidates.sort((a, b) => b.bodyLength - a.bodyLength);
    const sampled = candidates.slice(0, MAX_EMAILS_TO_SAMPLE);

    // Step 6: Build prompt for Claude
    const emailBlocks = sampled.map((e, i) =>
      `--- Email ${i + 1} (Subject: ${e.subject}) ---\n${e.body}`
    ).join("\n\n");

    const systemPrompt = "You are an expert writing style analyst. Analyze the following emails all written by the same person. Extract their distinctive writing patterns and style.";

    const userPrompt = `${emailBlocks}

---

Based on these ${sampled.length} emails, generate a writing style profile with exactly five sections:

1) **Tone & Voice** — How do they sound? Formal/casual/warm? What's their personality in writing?
2) **Opening Style** — How do they start emails? Do they jump in, use pleasantries, reference something specific?
3) **Closing & Sign-off** — How do they end emails? What sign-off do they use? Do they include a CTA?
4) **Things to Avoid** — What do they never do? Patterns that would feel out of character?
5) **Example Phrases** — Specific phrases, expressions, or patterns they use repeatedly.

Each section should be 2-4 sentences of specific, actionable observations. Be concrete — cite actual patterns you observed.

Return as JSON with keys: toneAndVoice, openingStyle, closingAndSignoff, thingsToAvoid, examplePhrases. Each value is a string.

Respond with ONLY the JSON object and nothing else — no prose before or after.`;

    // Step 7: Call Claude
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: [{
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Claude API error:", text);
      return jsonResponse({ error: "Style analysis failed" }, 502);
    }

    const data = await response.json();
    const textContent = data.content?.find((b: { type: string }) => b.type === "text");
    if (!textContent) {
      return jsonResponse({ error: "No text in Claude response" }, 502);
    }

    // Step 8: Parse JSON (tolerate code fences and surrounding prose)
    let styleResult: StyleResult;
    try {
      const stripped = textContent.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const match = stripped.match(/\{[\s\S]*\}/);
      if (!match) {
        return jsonResponse({ error: "Failed to parse style analysis result" }, 502);
      }
      styleResult = JSON.parse(match[0]);
    } catch {
      return jsonResponse({ error: "Failed to parse style analysis result" }, 502);
    }

    // Guardrail: before we persist Claude's output, make sure every required
    // field is a non-empty string. Without this check we could write partial
    // or malformed profiles (e.g. undefined values becoming NULL columns).
    const requiredFields = [
      "toneAndVoice",
      "openingStyle",
      "closingAndSignoff",
      "thingsToAvoid",
      "examplePhrases",
    ] as const;
    for (const field of requiredFields) {
      const value = (styleResult as Record<string, unknown>)[field];
      if (typeof value !== "string" || !value.trim()) {
        console.error(`Style result missing/invalid field: ${field}`);
        return jsonResponse({ error: "Claude returned incomplete style profile" }, 502);
      }
    }

    // Step 9: Upsert into rep_style_guides
    const oldestDate = sampled.length > 0
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      : null;
    const newestDate = new Date().toISOString().split("T")[0];

    const { error: upsertError } = await client.from("rep_style_guides").upsert({
      rep_email: repEmail,
      tone_and_voice: styleResult.toneAndVoice,
      opening_style: styleResult.openingStyle,
      closing_and_signoff: styleResult.closingAndSignoff,
      things_to_avoid: styleResult.thingsToAvoid,
      example_phrases: styleResult.examplePhrases,
      generated_from: {
        email_count: sampled.length,
        total_candidates: candidates.length,
        date_range: `${oldestDate} to ${newestDate}`,
        model: MODEL,
        analyzed_at: new Date().toISOString(),
      },
    }, { onConflict: "rep_email" });

    if (upsertError) {
      console.error("Style guide upsert failed:", upsertError.message);
      return jsonResponse({ error: "Failed to save style guide" }, 500);
    }

    // Step 10: Return result
    return jsonResponse({
      toneAndVoice: styleResult.toneAndVoice,
      openingStyle: styleResult.openingStyle,
      closingAndSignoff: styleResult.closingAndSignoff,
      thingsToAvoid: styleResult.thingsToAvoid,
      examplePhrases: styleResult.examplePhrases,
      emailsAnalyzed: sampled.length,
      dateRange: `${oldestDate} to ${newestDate}`,
    });
  } catch (e) {
    console.error("analyze-style error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
