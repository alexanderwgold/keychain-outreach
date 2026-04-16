# Rep Style Guide & Contact Activity Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-rep AI-generated writing style guides (with onboarding email scan) and a contact email activity feed in the draft drawer.

**Architecture:** New `rep_style_guides` table stores 5 editable style sections per rep. `analyze-style` Edge Function scans Gmail sent emails and calls Claude Sonnet to extract patterns. Style guide is injected as a second cached system block in `generate-draft`. Draft generation is gated on having a style guide. `get-contact-emails` Edge Function reads Gmail threads on demand for the draft drawer's contact activity panel.

**Tech Stack:** Supabase Edge Functions (Deno), Claude API (claude-sonnet-4-6 for analysis, claude-opus-4-6 for drafting), Gmail API, Next.js 16 / React 19, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-16-style-guide-and-contact-feed-design.md`

---

## File Structure

### New migrations
- `supabase/migrations/007_rep_style_guides.sql` — table, RLS, updated_at trigger

### New Edge Functions
- `supabase/functions/analyze-style/index.ts` — Gmail scan + Claude style analysis
- `supabase/functions/save-style-guide/index.ts` — CRUD upsert for style guide edits
- `supabase/functions/get-contact-emails/index.ts` — Gmail thread fetch for contact feed

### New frontend
- `frontend/src/app/(app)/settings/page.tsx` — settings page shell
- `frontend/src/components/settings/style-guide-form.tsx` — 5-section editable form with analyze trigger
- `frontend/src/components/drafting/contact-emails.tsx` — collapsible email thread list

### Modified files
- `supabase/functions/generate-draft/prompt.ts` — add `buildStyleBlock()` and `StyleGuide` interface
- `supabase/functions/generate-draft/index.ts` — add style guide gate + inject style block
- `frontend/src/components/drafting/draft-drawer.tsx` — add contact-emails section + style guide gate
- `frontend/src/components/layout/app-nav.tsx` — add Settings nav item

---

## Phase 1: Data Layer & Backend

### Task 1: rep_style_guides migration

**Files:**
- Create: `supabase/migrations/007_rep_style_guides.sql`

**Context:** Stores the 5 style sections per rep. Uses the existing `update_updated_at()` trigger from migration 002. FK references `rep_tokens(rep_email)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/007_rep_style_guides.sql`:

```sql
-- ============================================================
-- Migration 007: rep_style_guides table
-- Per-rep writing style profile for AI draft personalization.
-- ============================================================

create table rep_style_guides (
  id                  uuid        primary key default gen_random_uuid(),
  rep_email           text        unique not null references rep_tokens(rep_email),
  tone_and_voice      text        not null default '',
  opening_style       text        not null default '',
  closing_and_signoff text        not null default '',
  things_to_avoid     text        not null default '',
  example_phrases     text        not null default '',
  generated_from      jsonb       default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger rep_style_guides_updated_at
  before update on rep_style_guides
  for each row execute function update_updated_at();

alter table rep_style_guides enable row level security;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run: `mcp__supabase__apply_migration` with name `rep_style_guides` and the SQL above.

Verify: `mcp__supabase__list_tables` should show `rep_style_guides` in the list.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/migrations/007_rep_style_guides.sql && git commit -m "feat: add rep_style_guides table for per-rep writing style profiles

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: analyze-style Edge Function

**Files:**
- Create: `supabase/functions/analyze-style/index.ts`

**Context:** This is the onboarding function. It scans a rep's last 30 days of sent Gmail, filters to substantive external emails, samples the top 40, and sends them to Claude Sonnet to extract a 5-section style profile. Uses existing shared helpers: `google-auth.ts` for token refresh, `cors.ts` for browser access, `supabase-client.ts` for DB writes.

- [ ] **Step 1: Create the function**

Create `supabase/functions/analyze-style/index.ts`:

```typescript
import { createAdminClient } from "../_shared/supabase-client.ts";
import { refreshGoogleToken, googleApiFetch } from "../_shared/google-auth.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";

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

function isInternalOnly(to: string): boolean {
  const recipients = to.split(",").map((e) => e.trim().toLowerCase());
  return recipients.every((r) => r.includes(INTERNAL_DOMAIN));
}

function extractPlainText(payload: Record<string, unknown>): string {
  const parts = (payload.parts as Record<string, unknown>[]) ?? [];

  // Try to find plain text part first
  for (const part of parts) {
    if (part.mimeType === "text/plain" && (part.body as Record<string, unknown>)?.data) {
      const data = (part.body as Record<string, unknown>).data as string;
      return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    }
  }

  // Fallback to HTML part, strip tags
  for (const part of parts) {
    if (part.mimeType === "text/html" && (part.body as Record<string, unknown>)?.data) {
      const data = (part.body as Record<string, unknown>).data as string;
      const html = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
      return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  // Single-part message (no parts array)
  if ((payload.body as Record<string, unknown>)?.data) {
    const data = (payload.body as Record<string, unknown>).data as string;
    const decoded = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
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

        // Filter: skip calendar responses
        if (isCalendarResponse(subject)) continue;
        // Filter: skip auto-replies
        if (isAutoReply(subject)) continue;
        // Filter: skip internal-only emails
        if (isInternalOnly(to)) continue;

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

Return as JSON with keys: toneAndVoice, openingStyle, closingAndSignoff, thingsToAvoid, examplePhrases. Each value is a string.`;

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
        max_tokens: 1024,
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

    // Step 8: Parse JSON
    let styleResult: StyleResult;
    try {
      const jsonStr = textContent.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      styleResult = JSON.parse(jsonStr);
    } catch {
      return jsonResponse({ error: "Failed to parse style analysis result" }, 502);
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/analyze-style/ && git commit -m "feat: add analyze-style Edge Function for AI writing style onboarding

Scans 30 days of sent Gmail, filters to substantive external emails,
samples top 40, calls Claude Sonnet to extract 5-section style profile.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: save-style-guide Edge Function

**Files:**
- Create: `supabase/functions/save-style-guide/index.ts`

**Context:** Simple CRUD upsert. Separate from analyze-style so reps can edit and save without re-running analysis.

- [ ] **Step 1: Create the function**

Create `supabase/functions/save-style-guide/index.ts`:

```typescript
import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";

interface SaveRequest {
  repEmail: string;
  toneAndVoice: string;
  openingStyle: string;
  closingAndSignoff: string;
  thingsToAvoid: string;
  examplePhrases: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: SaveRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { repEmail, toneAndVoice, openingStyle, closingAndSignoff, thingsToAvoid, examplePhrases } = body;
  if (!repEmail) return jsonResponse({ error: "repEmail required" }, 400);

  try {
    const client = createAdminClient();

    const { error } = await client.from("rep_style_guides").upsert({
      rep_email: repEmail,
      tone_and_voice: toneAndVoice,
      opening_style: openingStyle,
      closing_and_signoff: closingAndSignoff,
      things_to_avoid: thingsToAvoid,
      example_phrases: examplePhrases,
    }, { onConflict: "rep_email" });

    if (error) {
      console.error("Style guide save failed:", error.message);
      return jsonResponse({ error: "Failed to save style guide" }, 500);
    }

    return jsonResponse({ success: true });
  } catch (e) {
    console.error("save-style-guide error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/save-style-guide/ && git commit -m "feat: add save-style-guide Edge Function for manual style edits

Simple upsert to rep_style_guides. Separate from analyze-style so
reps can edit without re-running email analysis.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Style guide gate + prompt integration in generate-draft

**Files:**
- Modify: `supabase/functions/generate-draft/prompt.ts`
- Modify: `supabase/functions/generate-draft/index.ts`

**Context:** Two changes: (1) add `buildStyleBlock()` to prompt.ts that formats the 5 style sections into a prompt block, (2) in index.ts, query `rep_style_guides` before generating — if no guide exists return 422, otherwise inject the style block as a second cached system message.

- [ ] **Step 1: Add StyleGuide interface and buildStyleBlock to prompt.ts**

Add to the end of `supabase/functions/generate-draft/prompt.ts`:

```typescript
export interface StyleGuide {
  tone_and_voice: string;
  opening_style: string;
  closing_and_signoff: string;
  things_to_avoid: string;
  example_phrases: string;
}

/**
 * Builds the style block for a rep's personal writing style.
 * Injected as a second system message with cache_control.
 * Returns null if any section is empty (guide not completed).
 */
export function buildStyleBlock(guide: StyleGuide): string | null {
  if (!guide.tone_and_voice && !guide.opening_style && !guide.closing_and_signoff) {
    return null;
  }

  return `Match this rep's writing style exactly. Here is their style profile:

## Tone & Voice
${guide.tone_and_voice}

## Opening Style
${guide.opening_style}

## Closing & Sign-off
${guide.closing_and_signoff}

## Things to Avoid
${guide.things_to_avoid}

## Example Phrases They Use
${guide.example_phrases}

Apply these patterns naturally. The email should sound like this specific person wrote it, not like a generic AI draft.`;
}
```

- [ ] **Step 2: Add style guide gate and injection to index.ts**

In `supabase/functions/generate-draft/index.ts`, add the import for `buildStyleBlock` and `StyleGuide`:

Change the import line from:
```typescript
import { buildSystemPrompt, buildUserPrompt, type DraftContext } from "./prompt.ts";
```
to:
```typescript
import { buildSystemPrompt, buildUserPrompt, buildStyleBlock, type DraftContext, type StyleGuide } from "./prompt.ts";
```

Then, after the line `const client = createAdminClient();` (line 41) and before `// Step 1: Load contact + opportunity context`, insert:

```typescript
    // Style guide gate: require rep to have a style guide
    const { data: styleGuide, error: styleError } = await client
      .from("rep_style_guides")
      .select("tone_and_voice, opening_style, closing_and_signoff, things_to_avoid, example_phrases")
      .eq("rep_email", opp?.rep_email ?? "")
      .single();
```

Wait — we need the `opp` data first to get `rep_email`. Let me restructure. The gate check should happen after we load the opportunity (to get `rep_email`). Insert the gate check after the opportunity is loaded (after line 51 `if (oppError || !opp) return jsonResponse(...)`) and before `// Find the specific contact`:

```typescript
    // Style guide gate: require rep to have a style guide before generating
    const { data: styleGuide } = await client
      .from("rep_style_guides")
      .select("tone_and_voice, opening_style, closing_and_signoff, things_to_avoid, example_phrases")
      .eq("rep_email", opp.rep_email)
      .single();

    if (!styleGuide) {
      return jsonResponse({ error: "style_guide_required", code: "NO_STYLE_GUIDE" }, 422);
    }
```

Then, change the Claude API call's `system` array (around line 194) from:

```typescript
        system: [{
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        }],
```

to:

```typescript
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
          ...(buildStyleBlock(styleGuide as StyleGuide)
            ? [{
                type: "text" as const,
                text: buildStyleBlock(styleGuide as StyleGuide)!,
                cache_control: { type: "ephemeral" as const },
              }]
            : []),
        ],
```

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/generate-draft/prompt.ts supabase/functions/generate-draft/index.ts && git commit -m "feat: add style guide gate and prompt injection to generate-draft

Requires rep to have a style guide before generating drafts (422 if missing).
Injects rep's 5-section style profile as second cached system block.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: get-contact-emails Edge Function

**Files:**
- Create: `supabase/functions/get-contact-emails/index.ts`

**Context:** Fetches recent Gmail threads between the rep and a specific contact. Returns snippets + Gmail URLs. On-demand reads, no storage. Used by the draft drawer's contact activity panel.

- [ ] **Step 1: Create the function**

Create `supabase/functions/get-contact-emails/index.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/get-contact-emails/ && git commit -m "feat: add get-contact-emails Edge Function for contact activity feed

Fetches recent Gmail threads with a contact (90-day window).
Returns snippets, direction, dates, and Gmail URLs.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: Frontend

### Task 6: Settings page + style guide form

**Files:**
- Create: `frontend/src/app/(app)/settings/page.tsx`
- Create: `frontend/src/components/settings/style-guide-form.tsx`

**Context:** New route `/settings` under the `(app)` layout. The page loads the rep's existing style guide (if any) from the `save-style-guide` or queries Supabase directly. The form shows 5 labeled text areas, a "Build My Style Guide" button for onboarding, and a "Save Changes" button.

- [ ] **Step 1: Create the style guide form component**

Create `frontend/src/components/settings/style-guide-form.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sparkles, Save, RefreshCw, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import * as Sentry from "@sentry/nextjs"

interface StyleGuideData {
  toneAndVoice: string
  openingStyle: string
  closingAndSignoff: string
  thingsToAvoid: string
  examplePhrases: string
  generatedFrom?: {
    email_count?: number
    date_range?: string
    analyzed_at?: string
  }
}

interface StyleGuideFormProps {
  repEmail: string
  initialData: StyleGuideData | null
}

const SECTIONS = [
  { key: "toneAndVoice", label: "Tone & Voice", placeholder: "How you sound in emails — formal, casual, warm, direct..." },
  { key: "openingStyle", label: "Opening Style", placeholder: "How you typically start emails — pleasantries, jump straight in, reference something specific..." },
  { key: "closingAndSignoff", label: "Closing & Sign-off", placeholder: "How you end emails — sign-off phrase, CTA style, closing remarks..." },
  { key: "thingsToAvoid", label: "Things to Avoid", placeholder: "Phrases or patterns that would feel out of character for you..." },
  { key: "examplePhrases", label: "Example Phrases", placeholder: "Specific phrases, expressions, or patterns you use often..." },
] as const

export function StyleGuideForm({ repEmail, initialData }: StyleGuideFormProps) {
  const [data, setData] = useState<StyleGuideData>(initialData ?? {
    toneAndVoice: "",
    openingStyle: "",
    closingAndSignoff: "",
    thingsToAvoid: "",
    examplePhrases: "",
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasGuide = !!(data.toneAndVoice || data.openingStyle || data.closingAndSignoff)

  async function handleAnalyze() {
    setAnalyzing(true)
    setError(null)

    try {
      await Sentry.startSpan({ name: "style.analyze", op: "ai.run" }, async () => {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/analyze-style`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ repEmail }),
          }
        )

        const result = await response.json()

        if (!response.ok) {
          if (result.error === "insufficient_emails") {
            throw new Error(`Not enough emails found (${result.emailsFound}). You need at least 5 substantive sent emails in the last 30 days. You can fill in the sections manually instead.`)
          }
          throw new Error(result.error ?? "Analysis failed")
        }

        setData({
          toneAndVoice: result.toneAndVoice,
          openingStyle: result.openingStyle,
          closingAndSignoff: result.closingAndSignoff,
          thingsToAvoid: result.thingsToAvoid,
          examplePhrases: result.examplePhrases,
          generatedFrom: {
            email_count: result.emailsAnalyzed,
            date_range: result.dateRange,
            analyzed_at: new Date().toISOString(),
          },
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed"
      setError(message)
      Sentry.captureException(err)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaveSuccess(false)

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/save-style-guide`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repEmail,
            toneAndVoice: data.toneAndVoice,
            openingStyle: data.openingStyle,
            closingAndSignoff: data.closingAndSignoff,
            thingsToAvoid: data.thingsToAvoid,
            examplePhrases: data.examplePhrases,
          }),
        }
      )

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error ?? "Save failed")
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed"
      setError(message)
      Sentry.captureException(err)
    } finally {
      setSaving(false)
    }
  }

  function updateField(key: string, value: string) {
    setData((prev) => ({ ...prev, [key]: value }))
    setSaveSuccess(false)
  }

  return (
    <div className="space-y-6">
      {/* Onboarding: no guide yet */}
      {!hasGuide && !analyzing && (
        <Card className="border-kc-gold/30 bg-kc-gold-subtle/20">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <Sparkles className="h-8 w-8 text-kc-gold-dark" />
            <div>
              <p className="text-sm font-medium text-kc-charcoal">
                Build Your Writing Style Guide
              </p>
              <p className="mt-1 text-xs text-kc-text-muted max-w-sm">
                Claude will scan your last 30 days of sent emails to learn your writing style. This takes about 30 seconds. You can edit the result anytime.
              </p>
            </div>
            <Button
              onClick={handleAnalyze}
              className="gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
            >
              <Sparkles className="h-4 w-4" />
              Build My Style Guide
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Analyzing state */}
      {analyzing && (
        <Card className="border-kc-gold/30">
          <CardContent className="flex flex-col items-center gap-3 p-8">
            <Loader2 className="h-6 w-6 animate-spin text-kc-gold" />
            <p className="text-sm text-kc-text-muted">Analyzing your emails...</p>
            <p className="text-xs text-kc-text-muted">This usually takes 15-30 seconds</p>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-kc-danger/30 bg-kc-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-kc-danger" />
            <div>
              <p className="text-sm font-medium text-kc-danger">Error</p>
              <p className="mt-1 text-xs text-kc-text-muted">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Style guide form */}
      {hasGuide && !analyzing && (
        <>
          {data.generatedFrom?.email_count && (
            <p className="text-xs text-kc-text-muted">
              Generated from {data.generatedFrom.email_count} emails ({data.generatedFrom.date_range})
            </p>
          )}

          {SECTIONS.map(({ key, label, placeholder }) => (
            <Card key={key} className="border-kc-warm-gray-dark/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-kc-charcoal">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={data[key as keyof StyleGuideData] as string}
                  onChange={(e) => updateField(key, e.target.value)}
                  placeholder={placeholder}
                  rows={3}
                  className="resize-none text-sm"
                />
              </CardContent>
            </Card>
          ))}

          <div className="flex gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saveSuccess ? "Saved" : "Save Changes"}
            </Button>
            <Button
              onClick={() => {
                if (confirm("This will overwrite your current guide with a fresh analysis. Continue?")) {
                  handleAnalyze()
                }
              }}
              variant="outline"
              disabled={analyzing}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Rebuild from Emails
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the settings page**

Create `frontend/src/app/(app)/settings/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server"
import { StyleGuideForm } from "@/components/settings/style-guide-form"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const repEmail = user?.email ?? ""

  // Load existing style guide
  const { data: styleGuide } = await supabase
    .from("rep_style_guides")
    .select("tone_and_voice, opening_style, closing_and_signoff, things_to_avoid, example_phrases, generated_from")
    .eq("rep_email", repEmail)
    .single()

  const initialData = styleGuide
    ? {
        toneAndVoice: styleGuide.tone_and_voice,
        openingStyle: styleGuide.opening_style,
        closingAndSignoff: styleGuide.closing_and_signoff,
        thingsToAvoid: styleGuide.things_to_avoid,
        examplePhrases: styleGuide.example_phrases,
        generatedFrom: styleGuide.generated_from as Record<string, unknown> | undefined,
      }
    : null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Settings</h1>
        <p className="mt-1 text-kc-text-muted">
          Manage your writing style and preferences
        </p>
      </div>

      <StyleGuideForm repEmail={repEmail} initialData={initialData} />
    </div>
  )
}
```

- [ ] **Step 3: Add Settings to app navigation**

Modify `frontend/src/components/layout/app-nav.tsx`. Change the `NAV_ITEMS` array from:

```typescript
const NAV_ITEMS = [
  { href: "/dashboard", label: "Briefing", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
] as const
```

to:

```typescript
const NAV_ITEMS = [
  { href: "/dashboard", label: "Briefing", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Settings },
] as const
```

And add `Settings` to the lucide-react import:

```typescript
import { LayoutDashboard, GitBranch, Settings } from "lucide-react"
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -15
```

Expected: build passes, `/settings` is listed.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/app/\(app\)/settings/ frontend/src/components/settings/ frontend/src/components/layout/app-nav.tsx && git commit -m "feat: add Settings page with style guide form and email analysis

New /settings route with 5-section editable form. Reps can build their
style guide via Claude email analysis or fill in manually. Adds Settings
link to app navigation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Contact emails component + draft drawer integration

**Files:**
- Create: `frontend/src/components/drafting/contact-emails.tsx`
- Modify: `frontend/src/components/drafting/draft-drawer.tsx`

**Context:** Collapsible email thread list shown in the draft drawer between the contact card and generate buttons. Also adds the style guide gate to the draft drawer — if no style guide, show a prompt to build one instead of generate buttons.

- [ ] **Step 1: Create the contact emails component**

Create `frontend/src/components/drafting/contact-emails.tsx`:

```tsx
"use client"

import { useState, useEffect } from "react"
import { ChevronDown, ChevronRight, ArrowUpRight, ArrowDownLeft, ExternalLink, Loader2, Mail } from "lucide-react"

interface EmailThread {
  subject: string
  snippet: string
  date: string
  direction: "sent" | "received"
  gmailUrl: string
}

interface ContactEmailsProps {
  repEmail: string
  contactEmail: string | null
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "today"
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ContactEmails({ repEmail, contactEmail }: ContactEmailsProps) {
  const [expanded, setExpanded] = useState(false)
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!contactEmail || !repEmail) return
    setLoading(true)
    setError(null)

    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contact-emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repEmail, contactEmail }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error === "no_google_token") {
          setError("Connect Google to see email history")
        } else {
          setThreads(data.threads ?? [])
        }
        setLoaded(true)
      })
      .catch(() => {
        setError("Failed to load emails")
        setLoaded(true)
      })
      .finally(() => setLoading(false))
  }, [repEmail, contactEmail])

  if (!contactEmail) return null

  return (
    <div className="rounded-lg border border-kc-warm-gray-dark/30 bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-kc-text-muted hover:text-kc-charcoal"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Mail className="h-3.5 w-3.5" />
        Recent Emails
        {loaded && !error && (
          <span className="text-kc-text-muted">({threads.length})</span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>

      {expanded && (
        <div className="border-t border-kc-warm-gray-dark/20 px-3 pb-2">
          {loading && !loaded && (
            <div className="flex items-center gap-2 py-3 text-xs text-kc-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading emails...
            </div>
          )}

          {error && (
            <p className="py-3 text-xs text-kc-text-muted">{error}</p>
          )}

          {loaded && !error && threads.length === 0 && (
            <p className="py-3 text-xs text-kc-text-muted">No recent emails with this contact</p>
          )}

          {threads.map((thread, i) => (
            <div
              key={i}
              className="flex items-start gap-2 border-b border-kc-warm-gray-dark/10 py-2 last:border-0"
            >
              {thread.direction === "sent" ? (
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kc-gold-dark" />
              ) : (
                <ArrowDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kc-text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-kc-charcoal">{thread.subject}</p>
                <p className="truncate text-xs text-kc-text-muted">{thread.snippet}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs text-kc-text-muted">{formatRelativeDate(thread.date)}</span>
                <a
                  href={thread.gmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-kc-text-muted hover:text-kc-charcoal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update the draft drawer**

Modify `frontend/src/components/drafting/draft-drawer.tsx`. Three changes:

**Change A: Add imports.** Add at the top of the file:

```typescript
import { ContactEmails } from "./contact-emails"
import Link from "next/link"
```

**Change B: Add style guide check state.** Add to the state declarations (after `const [draftCreated, setDraftCreated] = useState(false)`):

```typescript
  const [hasStyleGuide, setHasStyleGuide] = useState<boolean | null>(null) // null = loading
```

And in the `resetState()` function, add at the end:

```typescript
    // Check if rep has a style guide
    setHasStyleGuide(null)
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/save-style-guide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repEmail: contact?.repEmail ?? "" }),
    }).catch(() => {})
    // Lightweight check: try to read the style guide
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rep_style_guides?rep_email=eq.${encodeURIComponent(contact?.repEmail ?? "")}&select=rep_email`, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
    })
      .then((res) => res.json())
      .then((data) => setHasStyleGuide(Array.isArray(data) && data.length > 0))
      .catch(() => setHasStyleGuide(false))
```

**Change C: Add ContactEmails section and style guide gate.** In the JSX, after the contact context card (`</div>` closing the `rounded-lg bg-kc-warm-gray p-3` div) and before the generate buttons section, add:

```tsx
            {/* Contact email history */}
            <ContactEmails
              repEmail={contact.repEmail}
              contactEmail={contact.contactEmail}
            />

            {/* Style guide gate */}
            {hasStyleGuide === false && !generating && (
              <Card className="border-kc-gold/30 bg-kc-gold-subtle/20">
                <CardContent className="p-4 text-center">
                  <p className="text-sm font-medium text-kc-charcoal">
                    Set up your writing style first
                  </p>
                  <p className="mt-1 text-xs text-kc-text-muted">
                    Before generating drafts, Claude needs to learn your writing style. This takes about 30 seconds.
                  </p>
                  <Link href="/settings">
                    <Button className="mt-3 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark">
                      <Sparkles className="h-4 w-4" />
                      Build My Style Guide
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
```

Also add `Card, CardContent` to the shadcn import if not already present, and update the generate buttons condition from:

```tsx
            {!hasGenerated && !generating && (
```

to:

```tsx
            {!hasGenerated && !generating && hasStyleGuide && (
```

This hides the generate buttons when there's no style guide.

- [ ] **Step 3: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -15
```

Expected: build passes.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/drafting/contact-emails.tsx frontend/src/components/drafting/draft-drawer.tsx && git commit -m "feat: add contact email feed and style guide gate to draft drawer

Collapsible email thread list with Gmail links. Generate buttons hidden
until rep completes their style guide onboarding.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Completion Checklist

### Rep Style Guide
- [ ] `rep_style_guides` table created with FK, RLS, updated_at trigger
- [ ] `analyze-style` function scans Gmail, filters, samples, calls Claude Sonnet
- [ ] `analyze-style` returns 422 with `insufficient_emails` if < 5 emails found
- [ ] `save-style-guide` function upserts the 5 sections
- [ ] `generate-draft` returns 422 `NO_STYLE_GUIDE` if rep has no guide
- [ ] `generate-draft` injects style block as second cached system message
- [ ] Settings page at `/settings` with 5-section form
- [ ] "Build My Style Guide" button runs analysis and pre-fills form
- [ ] "Rebuild from Emails" button re-runs with confirmation
- [ ] Settings link added to app navigation

### Contact Activity Feed
- [ ] `get-contact-emails` function fetches Gmail threads with a contact
- [ ] Returns snippets, direction, dates, Gmail URLs (90-day window, max 10 threads)
- [ ] `ContactEmails` component shown in draft drawer, collapsible
- [ ] Loading, empty, and error states handled
- [ ] "Open in Gmail" links open in new tab

### Style Guide Gate
- [ ] Draft drawer hides generate buttons when rep has no style guide
- [ ] Shows "Build My Style Guide" prompt with link to `/settings`
- [ ] Backend enforces gate independently (422 response)
