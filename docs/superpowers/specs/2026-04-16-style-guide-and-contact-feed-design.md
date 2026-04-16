# Rep Style Guide & Contact Activity Feed — Design Spec

**Date:** 2026-04-16
**Status:** Approved

---

## Overview

Two features that improve draft quality and give reps context when composing outreach:

1. **Rep Style Guide** — Claude analyzes a rep's last 30 days of sent emails to generate a personalized writing style profile. Stored as 5 editable sections per rep. Injected into every draft generation call. Reps must complete their style guide before generating any drafts.

2. **Contact Activity Feed** — A collapsible panel in the draft drawer showing the rep's recent email threads with the contact they're drafting for. Snippets with "Open in Gmail" links. On-demand Gmail API reads, no persistent storage.

---

## Feature 1: Rep Style Guide

### Data Model

New table `rep_style_guides`:

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, default gen_random_uuid() | |
| rep_email | text | unique, not null, FK to rep_tokens(rep_email) | One guide per rep |
| tone_and_voice | text | not null default '' | "Professional but approachable..." |
| opening_style | text | not null default '' | "Leads with something personal..." |
| closing_and_signoff | text | not null default '' | "Signs off with 'Best, Alex'..." |
| things_to_avoid | text | not null default '' | "Never uses 'just checking in'..." |
| example_phrases | text | not null default '' | Common phrases Claude noticed |
| generated_from | jsonb | default '{}'::jsonb | Metadata: email_count, date_range, model |
| created_at | timestamptz | not null, default now() | |
| updated_at | timestamptz | not null, default now() | With update_updated_at trigger |

RLS enabled. Edge Functions bypass via service role key.

### Edge Function: `analyze-style`

**Method:** POST
**Auth:** Anon key. The function verifies `repEmail` exists in `rep_tokens` with `is_active = true` before proceeding. Uses admin client internally for DB writes and Vault access.
**Input:** `{ repEmail: string }`
**Output:** `{ toneAndVoice, openingStyle, closingAndSignoff, thingsToAvoid, examplePhrases, emailsAnalyzed, dateRange }`

**Flow:**

1. Refresh Google access token for the rep via `refreshGoogleToken()`
2. Search Gmail: `in:sent newer_than:30d`
3. Fetch message metadata + snippets for all results (up to 500)
4. Filter out:
   - Internal emails (all recipients are @keychain.com)
   - Short messages (<50 characters body length)
   - Calendar responses (subject starts with "Accepted:", "Declined:", "Tentative:")
   - Auto-replies (subject contains "Out of Office", "Automatic reply")
5. Sort remaining by body length descending, take top 40
6. For each selected email, fetch the full body text (plain text preferred, strip HTML if needed)
7. Send to Claude API with this prompt structure:
   - System: "You are an expert writing style analyst. Analyze the following emails all written by the same person. Extract their distinctive writing patterns and style."
   - User: The 40 email bodies, each delimited, followed by: "Based on these emails, generate a writing style profile with exactly five sections: 1) Tone & Voice, 2) Opening Style, 3) Closing & Sign-off, 4) Things to Avoid, 5) Example Phrases. Each section should be 2-4 sentences of specific, actionable observations. Return as JSON with keys: toneAndVoice, openingStyle, closingAndSignoff, thingsToAvoid, examplePhrases."
   - Use `cache_control: { type: "ephemeral" }` on the system prompt
   - Model: `claude-sonnet-4-6` (cheaper than opus for analysis tasks, still excellent at pattern recognition)
   - Max tokens: 1024
8. Parse the JSON response
9. Upsert into `rep_style_guides`
10. Return the five sections + metadata (emails analyzed count, date range)

**Error handling:** If fewer than 5 substantive emails found, return a specific error: `{ error: "insufficient_emails", emailsFound: <n> }`. The frontend prompts the rep to write their style guide manually instead.

**Cost estimate:** ~40 emails at ~200 tokens each = ~8K input tokens + ~500 output tokens. At Sonnet pricing, roughly $0.03-0.05 per analysis. Negligible.

### Edge Function: `save-style-guide`

**Method:** POST
**Auth:** Anon key (rep saves their own guide)
**Input:** `{ repEmail, toneAndVoice, openingStyle, closingAndSignoff, thingsToAvoid, examplePhrases }`
**Output:** `{ success: true }`

Simple upsert to `rep_style_guides`. Separate from `analyze-style` so the rep can edit and save without re-running analysis.

### Style Guide Gate

**Backend (generate-draft/index.ts):** Before generating a draft, query `rep_style_guides` for the rep's email. If no row exists, return:
```json
{ "error": "style_guide_required", "code": "NO_STYLE_GUIDE" }
```
with HTTP 422.

**Frontend (draft-drawer.tsx):** On drawer open, check if the rep has a style guide (could be a lightweight HEAD request or a flag stored in a React context/cookie after first check). If no style guide:
- Hide the generate buttons
- Show a message: "Before generating drafts, Claude needs to learn your writing style. This takes about 30 seconds."
- Show a "Build My Style Guide" button that navigates to `/settings`

### Prompt Integration

In `generate-draft/index.ts`, the Claude API call changes from one system block to two:

```typescript
system: [
  {
    type: "text",
    text: buildSystemPrompt(), // Generic Keychain context
    cache_control: { type: "ephemeral" },
  },
  {
    type: "text",
    text: buildStyleBlock(styleGuide), // Rep's personal style
    cache_control: { type: "ephemeral" },
  },
],
```

`buildStyleBlock()` in `prompt.ts` formats the five sections:

```
Match this rep's writing style exactly. Here is their style profile:

## Tone & Voice
{toneAndVoice}

## Opening Style
{openingStyle}

## Closing & Sign-off
{closingAndSignoff}

## Things to Avoid
{thingsToAvoid}

## Example Phrases They Use
{examplePhrases}

Apply these patterns naturally. The email should sound like this specific person wrote it, not like a generic AI draft.
```

Both system blocks are cached together per-rep. The per-contact user prompt remains uncached and unique.

### Frontend: Settings Page

**Route:** `/settings` (under `(app)` layout, same as dashboard/pipeline)

**Components:**
- `frontend/src/app/(app)/settings/page.tsx` — page shell, loads style guide data
- `frontend/src/components/settings/style-guide-form.tsx` — the form

**Style Guide Form UX:**

If no style guide exists:
- Prominent "Build My Style Guide" button
- Brief explanation: "Claude will scan your last 30 days of sent emails to learn your writing style."
- Progress state: "Analyzing your emails..." with a spinner (takes ~15-20 seconds)
- On completion: the 5 sections appear pre-filled in editable text areas

If style guide exists:
- 5 labeled text areas (Tone & Voice, Opening Style, Closing & Sign-off, Things to Avoid, Example Phrases)
- Each pre-filled with current values
- "Save Changes" button at bottom
- "Rebuild from Emails" button (secondary) — re-runs analysis with confirmation dialog ("This will overwrite your current guide. Continue?")
- Metadata line: "Generated from 38 emails (Mar 17 - Apr 16, 2026)"

**Navigation:** Add "Settings" to the app sidebar/nav, alongside Dashboard and Pipeline.

---

## Feature 2: Contact Activity Feed

### Edge Function: `get-contact-emails`

**Method:** POST
**Auth:** Anon key with rep email verification
**Input:** `{ repEmail: string, contactEmail: string }`
**Output:** `{ threads: Array<{ subject, snippet, date, direction, gmailUrl }> }`

**Flow:**

1. Refresh Google access token for the rep
2. Search Gmail: `from:{contactEmail} OR to:{contactEmail} newer_than:90d`
3. Fetch up to 20 message IDs from search
4. For each message, fetch metadata only (format=metadata, headers: From, To, Subject, Date)
5. Deduplicate by thread ID (Gmail groups messages into threads — take the latest message per thread)
6. For each unique thread, determine:
   - `subject`: from the Subject header
   - `snippet`: from the message snippet field (Gmail provides ~100 chars)
   - `date`: from the Date header, formatted as ISO string
   - `direction`: "sent" if rep is in From, "received" otherwise
   - `gmailUrl`: `https://mail.google.com/mail/u/0/#inbox/{threadId}`
7. Return the 10 most recent threads, sorted by date descending

**Performance:** Metadata-only fetches are fast. The Gmail search + 20 metadata fetches should complete in ~300-500ms.

**Error handling:** If rep has no Google token, return `{ threads: [], error: "no_google_token" }`. Frontend shows "Connect Google to see email history."

### Frontend: Contact Emails Component

**Component:** `frontend/src/components/drafting/contact-emails.tsx`

**Placement in draft drawer:** Between the contact context card and the generate buttons (or compose form).

**UX:**

- Collapsible section, collapsed by default with header: "Recent Emails (7)" showing thread count
- Click to expand
- Each thread row shows:
  - Direction icon (arrow-up-right for sent, arrow-down-left for received)
  - Subject line (truncated)
  - Snippet (truncated, muted text)
  - Relative date ("2d ago", "Mar 12")
  - "Open in Gmail" icon-link (external link icon, opens in new tab)
- Loading: skeleton rows while fetching
- Empty state: "No recent emails with this contact"
- Error state (no Google token): "Connect Google to see email history"

**Fetch timing:** The `get-contact-emails` call fires when the draft drawer opens, in parallel with the drawer animation. By the time the drawer is fully open, the data is usually ready.

**No caching:** Each drawer open fetches fresh from Gmail API. Avoids stale data.

---

## Environment & Dependencies

**New env vars:** None. All existing env vars (Google OAuth, Anthropic API key) are sufficient.

**New scopes:** None needed. `gmail.readonly` (already granted) covers both the style analysis email scan and the contact activity feed.

**New shared helpers:** None. Both features use existing `google-auth.ts`, `cors.ts`, and `supabase-client.ts`.

---

## Migration Summary

One new migration:
- `007_rep_style_guides.sql` — table, RLS, updated_at trigger, unique constraint on rep_email

---

## File Inventory

### New files
- `supabase/migrations/007_rep_style_guides.sql`
- `supabase/functions/analyze-style/index.ts`
- `supabase/functions/save-style-guide/index.ts`
- `supabase/functions/get-contact-emails/index.ts`
- `frontend/src/app/(app)/settings/page.tsx`
- `frontend/src/components/settings/style-guide-form.tsx`
- `frontend/src/components/drafting/contact-emails.tsx`

### Modified files
- `supabase/functions/generate-draft/prompt.ts` — add `buildStyleBlock()`
- `supabase/functions/generate-draft/index.ts` — add style guide gate + inject style block into system prompt
- `frontend/src/components/drafting/draft-drawer.tsx` — add contact-emails section + style guide gate
- App navigation component — add Settings link
