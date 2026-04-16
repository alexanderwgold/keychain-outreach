import { createAdminClient } from "../_shared/supabase-client.ts";
import { refreshGoogleToken, googleApiFetch } from "../_shared/google-auth.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

interface GetContactEmailsRequest {
  repEmail: string;
  contactEmail: string;
}

interface EmailThread {
  subject: string;
  snippet: string;
  date: string;
  direction: "sent" | "received";
  gmailUrl: string;
}

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return (match ? match[1] : headerValue).trim().toLowerCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: GetContactEmailsRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { repEmail, contactEmail } = body;
  if (!repEmail || !contactEmail) {
    return jsonResponse({ error: "repEmail and contactEmail required" }, 400);
  }

  try {
    const client = createAdminClient();

    // Verify rep has active token
    const { data: repToken } = await client
      .from("rep_tokens")
      .select("rep_email")
      .eq("rep_email", repEmail)
      .eq("is_active", true)
      .single();

    if (!repToken) {
      return jsonResponse({ threads: [], error: "no_google_token" });
    }

    const accessToken = await refreshGoogleToken(repEmail, client);

    // Search Gmail for threads with this contact (90-day window)
    const query = `from:${contactEmail} OR to:${contactEmail} newer_than:90d`;
    const searchResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}?q=${encodeURIComponent(query)}&maxResults=20`,
      accessToken
    );

    if (!searchResponse.ok) {
      return jsonResponse({ threads: [], error: `Gmail search failed: ${searchResponse.status}` });
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages ?? [];

    if (messages.length === 0) {
      return jsonResponse({ threads: [] });
    }

    // Fetch metadata for each message
    const threadMap = new Map<string, EmailThread>();

    const metadataResults = await Promise.all(
      messages.map(async (msg: { id: string; threadId: string }) => {
        const msgResponse = await googleApiFetch(
          `${GMAIL_MESSAGES_URL}/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          accessToken
        );
        if (!msgResponse.ok) return null;
        const data = await msgResponse.json();
        return { ...data, threadId: msg.threadId };
      })
    );

    for (const msgData of metadataResults) {
      if (!msgData) continue;

      const threadId = msgData.threadId;

      // Deduplicate by thread — keep the latest message per thread
      if (threadMap.has(threadId)) continue;

      const headers = msgData.payload?.headers ?? [];
      const from = headers.find((h: { name: string }) => h.name === "From")?.value ?? "";
      const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? "";
      const dateStr = headers.find((h: { name: string }) => h.name === "Date")?.value ?? "";
      const snippet = msgData.snippet ?? "";

      const fromEmail = extractEmail(from);
      const direction: "sent" | "received" = fromEmail === repEmail.toLowerCase() ? "sent" : "received";

      const date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

      threadMap.set(threadId, {
        subject: subject || "(no subject)",
        snippet,
        date,
        direction,
        gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
      });
    }

    // Sort by date descending, take top 10
    const threads = [...threadMap.values()]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);

    return jsonResponse({ threads });
  } catch (e) {
    console.error("get-contact-emails error:", (e as Error).message);
    return jsonResponse({ threads: [], error: (e as Error).message });
  }
});
