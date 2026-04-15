# Backend Edge Functions — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Launch target:** 2026-04-18 (Friday)

---

## Overview

Six Supabase Edge Functions that power the Keychain Outreach Tool's backend: Google OAuth token management, daily inbox/calendar/cadence scanning, AI-powered email drafting with vector-backed context, Gmail draft creation with attachments, batch web research, and Metabase data ingestion with embeddings.

**Design principles:**
- All per-rep operations run in `Promise.all()` — never sequential (Edge Functions timeout with 25+ reps)
- Refresh tokens stored in Supabase Vault — never plaintext
- Claude API calls use `cache_control: { type: "ephemeral" }` on system prompts
- One draft per generation (the best draft), not multiple variants
- Vector store (pgvector) for all reference data — Metabase stats, web research, collateral metadata

---

## Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `auth-callback` | HTTP GET (Google OAuth redirect) | Exchange auth code → store refresh token in Vault |
| `daily-scan` | pg_cron (weekdays 3:30pm ET) | SF email parse, Gmail scan, calendar scan (7-day rolling), cadence eval, auto-draft, Slack digest |
| `generate-draft` | HTTP POST (frontend + internal) | Claude generates single best draft using vector context. Two modes: standard / enhanced |
| `create-gmail-draft` | HTTP POST (frontend + internal) | Build MIME message with attachments, create Gmail draft via API |
| `research-batch` | pg_cron (1-2x/week) | Claude Batch API web research on active accounts, results stored in knowledge_base |
| `ingest-metabase` | HTTP POST (admin upload) | Parse Metabase CSV → embed with supabase.ai → upsert into knowledge_base |

---

## 1. Data Layer — pgvector & Knowledge Base

### New table: `knowledge_base`

A unified vector store for all data Claude can reference when drafting emails. One table regardless of source type — Claude doesn't care where data came from, it just needs the most relevant context for a given account.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE knowledge_source AS ENUM (
  'metabase_report',
  'web_research',
  'collateral'
);

CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type knowledge_source NOT NULL,
  source_id TEXT NOT NULL,              -- report filename, URL, document name
  account_name TEXT,                     -- NULL for general industry intel
  content TEXT NOT NULL,                 -- the raw text chunk
  embedding VECTOR(384) NOT NULL,        -- via supabase.ai.embedding('gte-small', content)
  metadata JSONB DEFAULT '{}',           -- flexible: report columns, search query, date range
  expires_at TIMESTAMPTZ,                -- web research expires after 7 days
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX knowledge_base_account_name_idx ON knowledge_base (account_name);
CREATE INDEX knowledge_base_source_type_idx ON knowledge_base (source_type);
CREATE INDEX knowledge_base_embedding_idx ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX knowledge_base_expires_at_idx ON knowledge_base (expires_at) WHERE expires_at IS NOT NULL;
```

### Embedding model

`gte-small` via `supabase.ai.embedding('gte-small', text)` — runs inside Supabase, no external API key, produces 384-dimension vectors. Free.

### Retrieval at draft time

```sql
SELECT content, metadata, source_type
FROM knowledge_base
WHERE (account_name = $1)
   OR (embedding <=> supabase.ai.embedding('gte-small', $2) < 0.3)
ORDER BY embedding <=> supabase.ai.embedding('gte-small', $2)
LIMIT 10;
```

Returns top 10 most relevant chunks — platform stats, recent research, collateral references — regardless of source.

### Supabase Storage bucket: `collateral`

Stores PDFs and documents that can be attached to Gmail drafts. Admin uploads files via the admin UI. The `2026 Edge Collateral.pdf` should be uploaded here for production use.

---

## 2. Auth — `auth-callback`

### Purpose

Handles the Google OAuth redirect after a rep authorizes the app. Exchanges the auth code for tokens, stores the refresh token in Vault, and redirects to the dashboard.

### Flow

```
Google redirects to:
  https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/auth-callback?code=xxx&state=xxx

auth-callback:
  1. Validate `state` parameter (CSRF prevention)
  2. POST https://oauth2.googleapis.com/token
     → grant_type: authorization_code
     → code, client_id, client_secret, redirect_uri
     → Returns: { access_token, refresh_token, scope, expires_in }
  3. GET https://www.googleapis.com/oauth2/v2/userinfo (with access_token)
     → Returns: { email, name, ... }
  4. Verify email exists in rep_mapping (reject unknown users)
  5. Store refresh_token in Supabase Vault:
     → SELECT vault.create_secret(refresh_token, 'rep_token_<email>', 'Google refresh token for <email>')
     → Returns: secret UUID
  6. Upsert rep_tokens row:
     → google_refresh_token = vault secret UUID
     → scopes = granted scopes string
     → is_active = true
  7. Redirect to https://keychain-outreach.vercel.app/dashboard
```

### Scopes

- `gmail.readonly` — scan inbox for activity
- `gmail.compose` — create drafts
- `calendar.readonly` — scan meetings
- `calendar.events` — create prep calendar blocks

### Env vars

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Security

- Refresh tokens never stored in plaintext — Vault only
- Access tokens are ephemeral, used once per function invocation, never stored
- `state` parameter validated to prevent CSRF
- Only emails present in `rep_mapping` can complete auth

### Shared token refresh helper

Used by all functions that call Google APIs. Lives in `_shared/google-auth.ts`:

```
refreshGoogleToken(repEmail):
  1. Query rep_tokens for vault secret UUID
  2. Query vault.decrypted_secrets to get plaintext refresh token
  3. POST https://oauth2.googleapis.com/token
     → grant_type: refresh_token
     → refresh_token, client_id, client_secret
  4. Return short-lived access_token (never stored, never cached across invocations)
```

### Blocker

This function requires eng to add the redirect URI `https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/auth-callback` to Google Cloud Console. Can be built and deployed before that's done, but won't work end-to-end until configured.

---

## 3. Daily Scan — `daily-scan`

### Schedule

Weekdays 3:30pm ET via pg_cron.

### Architecture

Orchestrator + parallel workers. The orchestrator fetches all active reps, then runs each rep's scan pipeline in `Promise.all()`. Within each rep, independent steps run in parallel; dependent steps wait.

```
daily-scan (orchestrator)
  │
  ├─ Load all active reps from rep_tokens (is_active = true)
  │
  ├─ For each rep (in parallel via Promise.all):
  │   │
  │   ├─ [PARALLEL] Step 1: scan-sf-email
  │   ├─ [PARALLEL] Step 2: scan-gmail
  │   ├─ [PARALLEL] Step 3: scan-calendar
  │   ├─ [PARALLEL] Step 5: check-draft-status
  │   │
  │   ├─ [SEQUENTIAL — waits for 1,2,3] Step 4: eval-cadence
  │   │
  │   └─ [SEQUENTIAL — waits for all] Step 6: compose-digest
  │
  └─ After all reps: Step 7: compose-founder-digest
```

### Step 1: scan-sf-email

Searches Gmail for the daily Salesforce report email, downloads the CSV attachment, and diffs against the `opportunities` table.

```
1. Gmail search: from:reports@salesforce.com newer_than:1d has:attachment
2. Download CSV attachment (base64 decode)
3. Parse CSV using existing csv-import parse logic
4. For each row, match against opportunities by sf_opportunity_id:
   → If fields changed (stage_name, amount, opp_owner, etc): update opportunity
   → If opp was previously Closed/Lost but reappears: overwrite stage_name
     (report only contains active opps — reappearance means reopened)
   → Do NOT update close_date (not in SF report)
   → Insert activity_log row: type 'sf_update', source 'sf_report'
5. Update opportunities.last_sf_sync_at = now()
```

**Returns:** `{ sfUpdates: [{ accountName, field, oldVal, newVal }] }`

**Note:** The SF report email attachment format is unverified — the parsing logic should handle both CSV and HTML table formats defensively.

### Step 2: scan-gmail

Scans Gmail for email activity with contacts in the rep's pipeline.

```
1. Gmail search: newer_than:1d (or since rep_tokens.last_scan_at)
2. For each message, check sender/recipient against contacts.email
   for this rep's opportunities
3. Classify:
   → Sent by rep to contact = email_sent
   → Sent by contact to rep = email_received
   → Reply in existing thread = reply_received
4. Insert activity_log rows: source 'gmail'
5. Deduplicate: skip if activity_log already has this Gmail message ID
```

**Returns:** `{ emailActivity: [{ contactName, type, subject }] }`

### Step 3: scan-calendar

Scans Google Calendar for meetings — both backward (today, for logging) and forward (next 7 days, for prep).

```
Backward (today):
  1. Pull today's calendar events
  2. Match attendee emails against contacts.email
  3. Insert activity_log: type 'meeting_held', source 'calendar'

Forward (next 7 days, rolling window):
  4. Pull events for next 7 days
  5. Match attendee emails against contacts.email
  6. Upsert into upcoming_meetings table
  7. Infer meeting type from event title:
     → "intro" → intro
     → "demo" / "meeting" → meeting
     → "proposal" / "pricing" → proposal
     → "next steps" / "follow" → next_steps
     → "catch" / "check in" → catch_up
     → else → unknown
  8. Detect stage progressions:
     → Had intro recently + meeting/proposal upcoming = progression
     → Had meeting recently + proposal/next_steps upcoming = progression
     → Set stage_progression_detected = true
  9. For meetings with no prep email in activity_log:
     → Call generate-draft with trigger: 'meeting_prep'
     → Call create-gmail-draft with the result
     → Create 30-min prep calendar block before the meeting
       (title: "Prep: [Meeting Title]", description includes key stats)
```

**Returns:** `{ meetingsToday: [...], upcomingMeetings: [...], progressions: [...], prepDraftsCreated: int }`

### Step 4: eval-cadence

Evaluates cadence compliance for all active opportunities. Depends on Steps 1-3 completing (needs complete activity picture).

```
1. For each active opportunity (stage in ACTIVE_STAGES):
   → Find most recent activity_log row
   → Calculate days since last touch
   → Look up cadence_rules.days_between_touches for current stage_name
   → Classify:
     - On track: days < threshold
     - Due soon: days >= threshold * 0.8
     - Overdue: days >= threshold
     - Critical: days >= threshold * 2
2. For CRITICAL contacts (>= 2x threshold):
   → Auto-draft via generate-draft (mode: 'standard', trigger: 'auto_overdue')
   → Create Gmail draft via create-gmail-draft
   → Flag as auto-drafted in results
```

**Returns:** `{ overdue: [{ contactName, daysSince, threshold, autoDrafted }] }`

### Step 5: check-draft-status

Checks Gmail for unsent AI-generated drafts.

```
1. Query Gmail drafts folder
2. Filter for drafts with "Keychain-AI" label
3. Return list of pending drafts with contact name, subject, creation date
```

**Returns:** `{ pendingDrafts: [{ contactName, subject, createdAt }] }`

### Step 6: compose-digest (per rep)

Assembles scan results into a formatted Slack DM. Sent via Slack Web API (not MCP).

```
1. Look up Slack user ID:
   → POST https://slack.com/api/users.lookupByEmail?email=rep@keychain.com
2. Open DM channel:
   → POST https://slack.com/api/conversations.open?users=SLACK_USER_ID
3. Format digest message (omit empty sections):

   *Daily Briefing — Tuesday, April 15*

   *SF Updates Detected*
   • Tea India — stage: Prospect → First Meeting
   • American Pharma — amount: $50K → $75K

   *Activity Today*
   • 3 emails sent, 2 received, 1 meeting held

   *Drafts Ready in Gmail*
   • Tea India — "Quick question about sourcing" (created yesterday)
   • BNutty — "Partnership opportunity" (auto-drafted, overdue 14d)

   *Follow-Ups Due*
   • **Extracto Líquido de Cacao** — 28 days overdue (threshold: 10d)
   • Rivoltini Alimentare — 8 days overdue (threshold: 7d)
   • American Desserts — 5 days (threshold: 7d, due in 2d)
   (2x+ threshold entries bolded with warning)

   *SF Update Notes* (paste into Salesforce)
   • Tea India: "Email sent 4/15, meeting scheduled 4/17"

4. POST https://slack.com/api/chat.postMessage
5. Update rep_tokens.last_scan_at = now()
```

**Error handling:** If Slack DM fails for one rep, log the error and continue — don't fail the entire scan.

### Step 7: compose-founder-digest

Runs after all rep scans complete. Aggregates team-wide metrics.

```
Format:

*Team Activity Report — Tuesday, April 15*

*Coverage Summary*
• 24/25 reps scanned successfully
• 847 active opportunities tracked
• 142 emails sent today, 89 received, 23 meetings held

*Attention Needed*
• 3 reps with 5+ critically overdue contacts
• Rep A: 8 overdue (highest: 34 days)
• Rep B: 6 overdue (highest: 21 days)
• Rep C: 5 overdue (highest: 18 days)

*Pipeline Movement*
• 12 stage progressions detected today
• 4 new First Meetings scheduled this week

Send via Slack DM to each founder email in ADMIN_EMAILS.
```

### Env vars

- `GOOGLE_CLIENT_ID` (for token refresh)
- `GOOGLE_CLIENT_SECRET` (for token refresh)
- `ANTHROPIC_API_KEY` (for auto-drafts)
- `SLACK_BOT_TOKEN` (for digest delivery)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Error handling

- Each worker catches its own errors and returns a partial result + error flag
- If scan-gmail fails for one rep, cadence eval still runs with whatever activity data exists
- If Slack DM fails, log and continue
- Orchestrator logs per-rep success/failure summary to console (visible in Supabase Edge Function logs)

---

## 4. AI Drafting — `generate-draft`

### Trigger

HTTP POST — called from frontend (rep clicks button) or internally (auto-draft for overdue contacts, meeting prep drafts).

### Input

```json
{
  "contactId": "uuid",
  "opportunityId": "uuid",
  "mode": "standard | enhanced",
  "context": {
    "trigger": "rep_initiated | auto_overdue | meeting_prep",
    "meetingTitle": "optional — for prep drafts",
    "meetingTime": "optional — ISO 8601"
  }
}
```

### Two modes

**Standard** — uses only internal data (Metabase stats from knowledge_base, activity history, cadence context, any previously stored web research). Fast, cheap, no external calls beyond Claude.

**Enhanced** — everything from standard, plus live web_search via Claude's tool use. Searches for recent company news, industry trends, competitor activity. Stores research results back into knowledge_base (source_type: 'web_research', expires_at: 7 days) so future standard drafts benefit too. Rate-limited to 20 calls/rep/day.

### Flow

```
generate-draft:
  1. Load context from DB:
     → contact: name, title, email, company
     → opportunity: stage, amount, close_date, account_name
     → activity_log: last 5 touches (type, date, notes)
     → cadence_rules: threshold, suggested_action for current stage

  2. Query knowledge_base (vector search):
     → Exact match on account_name first
     → Then embedding similarity search
     → Returns: top 10 relevant chunks (stats, research, collateral refs)

  3. If mode = "enhanced":
     → Call Claude with web_search tool enabled
     → Search for: recent news about company, industry trends,
       competitor activity, relevant announcements
     → Store results in knowledge_base:
       source_type: 'web_research'
       account_name: the account
       expires_at: now() + 7 days

  4. Call Claude to generate draft:

     System prompt (cached — cache_control: { type: "ephemeral" }):
       → Role: "You are a sales email writer for Keychain, a B2B sourcing
         marketplace connecting buyers with manufacturers."
       → Product context: what Keychain does, value props, differentiators
       → Tone guide: professional but warm, concise, data-driven when possible
       → Stage-specific guidance from cadence_rules.suggested_action
       → Instruction: generate one email — subject line + HTML body.
         The best possible email for this specific contact and situation.

     User prompt (not cached — unique per contact):
       → Contact details + opportunity context
       → Knowledge base results (stats, research)
       → Activity history (last 5 touches)
       → Trigger-specific instruction:
         - rep_initiated: "Draft outreach email for this contact"
         - auto_overdue: "This contact is X days overdue (threshold: Yd).
           Draft a re-engagement email."
         - meeting_prep: "Draft a pre-meeting email. Meeting: [title] on [date].
           Include relevant talking points and data."

  5. Return { subject, htmlBody } to caller
```

### Model

`claude-opus-4-6` — per docs/ai.md.

### Prompt caching

System prompt contains product context (~2K tokens) — identical across all draft calls, cached. Knowledge base results and contact details go in user prompt — unique per call, not cached. First call pays full price; subsequent calls within 5 min hit cache on the system prompt block.

### Rate limiting

- Enhanced mode: 20 calls/rep/day (tracked in activity_log with source: 'ai_draft')
- Standard mode: no hard limit
- Internal calls (auto_overdue, meeting_prep) always use standard mode

### Env vars

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 5. Gmail Draft Creation — `create-gmail-draft`

### Trigger

HTTP POST — from frontend "Create Draft" button or internally after auto-draft / meeting prep.

### Input

```json
{
  "repEmail": "rep@keychain.com",
  "to": "contact@company.com",
  "cc": ["optional@example.com"],
  "bcc": ["optional@example.com"],
  "subject": "Quick question about sourcing",
  "htmlBody": "<p>Hi Sarah,...</p>",
  "contactId": "uuid",
  "opportunityId": "uuid",
  "attachments": [
    {
      "storageKey": "collateral/2026-edge-collateral.pdf",
      "filename": "2026 Edge Collateral.pdf"
    }
  ]
}
```

### Flow

```
create-gmail-draft:
  1. Refresh Google access token via shared helper

  2. If attachments present:
     → Download each file from Supabase Storage bucket 'collateral'
     → Base64 encode file contents

  3. Build multipart MIME message:
     → Headers: To, Cc, Bcc, Subject, Content-Type: multipart/mixed
     → Part 1: text/html (the email body)
     → Part N: application/octet-stream per attachment
       Content-Disposition: attachment; filename="..."
       Content-Transfer-Encoding: base64

  4. Create Gmail draft:
     → POST https://gmail.googleapis.com/gmail/v1/users/me/drafts
     → Body: { message: { raw: base64url(mimeMessage) } }
     → Apply "Keychain-AI" label for tracking

  5. Insert activity_log row:
     → type: 'email_drafted'
     → source: 'ai_draft'
     → notes: JSON with subject, draft Gmail ID, attachment filenames

  6. Return { success: true, draftId: "gmail-draft-id" }
```

### Frontend email editor (update needed)

The existing draft drawer needs to be updated to match Gmail's compose experience:

- **To / Cc / Bcc fields** — Cc and Bcc hidden by default, expand on click
- **Subject line** — editable text input
- **Rich text toolbar** — bold, italic, underline, strikethrough, link, bullet list, numbered list, indent/outdent, text color, alignment (TipTap already handles most of this)
- **Attachment bar** — shows attached files with filename, size, remove button. "Attach from Collateral" button opens picker listing files from Supabase Storage `collateral` bucket
- **Bottom action bar** — "Create Draft" (primary gold button), "Discard", attachment button
- **Two generate buttons** — "Generate Draft" (standard mode) and "Generate Enhanced Draft" (enhanced mode with web research)

### Env vars

- `GOOGLE_CLIENT_ID` (token refresh)
- `GOOGLE_CLIENT_SECRET` (token refresh)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 6. Batch Research — `research-batch`

### Schedule

1-2x per week via pg_cron (e.g. Tuesday and Thursday 2am ET — off-peak for cost).

### Purpose

Proactively gathers web research for all active accounts. Results stored in knowledge_base so they're available for standard-mode drafts without needing the rep to use enhanced mode.

### Flow

```
research-batch:
  1. Query distinct account_name from opportunities
     WHERE stage_name IN (ACTIVE_STAGES)
     → ~500-1000 active accounts across all reps

  2. For each account, build a research prompt:
     → "Search for recent news, announcements, industry trends,
       and competitor activity related to [account_name]
       in the [industry] space. Focus on the last 30 days."

  3. Submit as Claude Batch API request:
     → 50% cost reduction vs real-time API
     → 24-hour turnaround window (fine for background research)
     → Include web_search tool in each request

  4. When batch completes (poll or webhook):
     → Parse each result into text chunks
     → Embed via supabase.ai.embedding('gte-small', chunk)
     → Upsert into knowledge_base:
       source_type: 'web_research'
       account_name: matched account
       expires_at: now() + 7 days
     → Delete expired rows (expires_at < now())

  5. Log summary: accounts researched, chunks stored, errors
```

### Cost estimate

- ~800 active accounts x ~500 tokens per research result = ~400K input tokens + tool use
- At Opus batch pricing (50% discount): roughly $3-5 per run
- 2x/week = $6-10/week

### Env vars

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 7. Metabase Ingest — `ingest-metabase`

### Trigger

HTTP POST — admin uploads CSV via admin UI.

### Purpose

Parses a Metabase CSV export, formats each row into a text chunk with context, embeds it, and upserts into the knowledge_base vector store.

### Known report format

First report: manufacturer platform activity data.

| Column | Description |
|--------|-------------|
| `manufacturer_name` | Keychain platform name |
| `salesforce_account_name` | Join key to opportunities |
| `tagged_micro_cat_projects_last_365_days` | Buyer projects matching their categories (1yr) |
| `tagged_micro_cat_projects_last_90_days` | Same, 90 days |
| `tagged_micro_cat_verified_projects_last_365_days` | Verified (higher intent) projects (1yr) |
| `tagged_micro_cat_verified_projects_last_90_days` | Same, 90 days |
| `tagged_micro_cat_views_last_90_days` | Category views (90d) |
| `tagged_micro_cat_views_last_365_days` | Category views (1yr) |

~61,500 rows. Updated ~monthly.

### Flow

```
ingest-metabase:
  1. Validate JWT (service-role or admin user)
  2. Read multipart form data: file field (CSV) + report_name field
  3. Parse CSV rows
  4. For each row, format into a text chunk:
     "[manufacturer_name] (SF: [salesforce_account_name]) —
      Projects: [90d] (90d), [365d] (1yr).
      Verified projects: [90d] (90d), [365d] (1yr).
      Category views: [90d] (90d), [365d] (1yr)."
  5. Embed each chunk: supabase.ai.embedding('gte-small', chunk)
  6. Upsert into knowledge_base in batches (500 rows per batch):
     → source_type: 'metabase_report'
     → source_id: report_name (e.g. 'manufacturer_activity_2026-04')
     → account_name: salesforce_account_name
     → Upsert key: (source_type, source_id, account_name)
       — replaces old data from previous month's upload
  7. Return { rowsProcessed, rowsUpserted, errors }
```

### Future report types

The system is designed so adding new Metabase reports requires only:
1. A new parsing function for the CSV columns
2. A text formatting template for the chunks
3. Same embedding + upsert pipeline

No schema changes, no new tables, no new search logic.

### Env vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 8. Slack Integration

### Approach

Minimal Slack app with two scopes: `chat:write` and `users:read.email`. No event subscriptions, no slash commands, no interactive components. The app's sole purpose is sending messages.

### Setup required

1. Create Slack app at api.slack.com/apps
2. Add OAuth scopes: `chat:write`, `users:read.email`
3. Install to Keychain workspace
4. Copy Bot User OAuth Token → store as `SLACK_BOT_TOKEN` in Supabase Edge Function secrets

### API calls used

```
Look up user: POST https://slack.com/api/users.lookupByEmail
  → Headers: Authorization: Bearer SLACK_BOT_TOKEN
  → Body: email=rep@keychain.com
  → Returns: { user: { id: "U12345" } }

Open DM: POST https://slack.com/api/conversations.open
  → Body: users=U12345
  → Returns: { channel: { id: "D12345" } }

Send message: POST https://slack.com/api/chat.postMessage
  → Body: channel=D12345, text="...", mrkdwn=true
  → Returns: { ok: true }
```

### Error handling

If any Slack API call fails for a rep, log the error and continue to the next rep. Never fail the entire daily scan because Slack is down.

---

## 9. Shared Modules

### `_shared/supabase-client.ts` (existing)

```typescript
export function createAdminClient(): SupabaseClient
// Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

### `_shared/google-auth.ts` (new)

```typescript
export async function refreshGoogleToken(repEmail: string): Promise<string>
// 1. Query rep_tokens for vault secret UUID
// 2. Query vault.decrypted_secrets for plaintext refresh token
// 3. POST to googleapis.com/token with grant_type=refresh_token
// 4. Return access_token (ephemeral, never stored)
```

### `_shared/slack.ts` (new)

```typescript
export async function sendSlackDM(email: string, message: string): Promise<void>
// 1. users.lookupByEmail → get Slack user ID
// 2. conversations.open → get DM channel ID
// 3. chat.postMessage → send formatted message

export async function lookupSlackUser(email: string): Promise<string>
// Returns Slack user ID for an email
```

### `_shared/knowledge.ts` (new)

```typescript
export async function queryKnowledgeBase(
  accountName: string,
  queryText: string,
  limit?: number
): Promise<KnowledgeChunk[]>
// Vector similarity search against knowledge_base table

export async function upsertKnowledge(
  chunks: KnowledgeChunk[],
  sourceType: string,
  sourceId: string
): Promise<void>
// Embed + upsert into knowledge_base in batches
```

---

## 10. Environment Variables

All stored as Supabase Edge Function secrets.

| Variable | Used by | Status |
|----------|---------|--------|
| `SUPABASE_URL` | All functions | Set |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | Set |
| `GOOGLE_CLIENT_ID` | auth-callback, daily-scan, generate-draft, create-gmail-draft | Needs setup |
| `GOOGLE_CLIENT_SECRET` | auth-callback, daily-scan, create-gmail-draft | Needs setup |
| `ANTHROPIC_API_KEY` | generate-draft, research-batch, daily-scan (auto-draft) | Needs setup |
| `SLACK_BOT_TOKEN` | daily-scan (digest) | Needs setup (after Slack app created) |

---

## 11. Cron Schedules (pg_cron)

```sql
-- Daily scan: weekdays at 3:30pm ET (7:30pm UTC during EDT)
SELECT cron.schedule(
  'daily-scan',
  '30 19 * * 1-5',
  $$SELECT net.http_post(
    'https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/daily-scan',
    '{}',
    'application/json',
    ARRAY[http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))]
  )$$
);

-- Research batch: Tuesday and Thursday at 2am ET (6am UTC during EDT)
SELECT cron.schedule(
  'research-batch',
  '0 6 * * 2,4',
  $$SELECT net.http_post(
    'https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/research-batch',
    '{}',
    'application/json',
    ARRAY[http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))]
  )$$
);
```

Both functions should also accept manual HTTP POST triggers for testing and ad-hoc runs.

### Not included (deferred)

- **Gong call detection** — the original spec included scanning Gmail for Gong call summary emails, but the email format is unverified. Deferred until we can test against a real Gong notification email. Can be added as a new worker step in daily-scan without architectural changes.

---

## 12. Frontend Updates Required

### Draft drawer redesign

Update the existing draft drawer (`frontend/src/components/drafting/draft-drawer.tsx`) to match Gmail's compose experience:

- **To field** — pre-filled with contact email, editable
- **Cc / Bcc fields** — hidden by default, "Cc Bcc" link expands them
- **Subject line** — editable text input
- **Rich text editor** — existing TipTap editor, ensure full toolbar: bold, italic, underline, strikethrough, link, lists, indent, text color, alignment
- **Attachment bar** — list of attached files (filename, size, remove button). "Attach" button opens picker showing files from Supabase Storage `collateral` bucket
- **Two generate buttons:**
  - "Generate Draft" — calls generate-draft with mode: standard
  - "Generate Enhanced Draft" — calls generate-draft with mode: enhanced. Visual indicator that this uses web search
- **Bottom actions** — "Create Draft" (creates Gmail draft), "Discard"
- **Remove variant picker** — no more 3-variant cards. Single draft appears in editor.

### Admin: Metabase upload

Add a "Metabase Reports" section to the admin page alongside the existing CSV upload. File drop zone that calls `ingest-metabase` Edge Function. Shows upload progress and row count on completion.

---

## 13. Implementation Priority

Build in this order — each piece is independently testable:

**Phase 1: Foundation (build first)**
1. `knowledge_base` migration (pgvector schema)
2. `_shared/google-auth.ts` helper
3. `_shared/slack.ts` helper
4. `_shared/knowledge.ts` helper
5. `auth-callback` Edge Function

**Phase 2: Data ingestion**
6. `ingest-metabase` Edge Function
7. Upload the manufacturer activity CSV as first dataset

**Phase 3: AI drafting (frontend-facing)**
8. `generate-draft` Edge Function
9. `create-gmail-draft` Edge Function
10. Frontend draft drawer redesign (Gmail-like controls)

**Phase 4: Daily automation**
11. `daily-scan` orchestrator + all worker steps
12. pg_cron schedule for daily-scan

**Phase 5: Background research**
13. `research-batch` Edge Function
14. pg_cron schedule for research-batch

Each phase produces working, testable functionality. Phase 3 is the highest user-facing impact — reps can start using AI drafting as soon as it's deployed, even before the daily scan is automated.
