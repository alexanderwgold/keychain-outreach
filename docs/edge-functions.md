# Edge Functions

All Edge Functions run on Supabase (Deno runtime). Deploy via `mcp__supabase__deploy_edge_function`. Check logs via `mcp__supabase__get_logs`.

**Critical constraint:** All per-rep operations must run in parallel using `Promise.all()`. With 25+ reps, sequential loops will hit Edge Function timeouts. This applies to the daily scan and weekly meeting scan.

---

## Functions

### `auth-callback`

**Trigger:** HTTP GET (redirect from Google OAuth)

**What it does:**
1. Receives `code` and `state` params from Google OAuth redirect
2. Exchanges `code` for `access_token` + `refresh_token` via Google token endpoint
3. Retrieves the rep's email from the Google userinfo endpoint
4. Stores the refresh token encrypted via Supabase Vault in `rep_tokens`
5. Sets `is_active = true`, updates `scopes`
6. Redirects rep to the frontend dashboard

**Key detail:** Use Supabase Vault (`vault.create_secret`) to store the refresh token — never write it to a plaintext column.

---

### `daily-scan`

**Trigger:** Cron, weekdays at 3:30pm ET

**What it does (per rep, all reps in parallel):**

#### Step 1 — SF report email sync
- Search Gmail for emails from `reports@salesforce.com` with the SF report subject line, received today
- Parse the CSV attachment. Match each row to `opportunities` by `Opportunity ID` → `sf_opportunity_id`
- Update fields: `stage_name`, `amount`, `next_step`, `opportunity_name`, `account_name`, `categories`, `company_category`. Also set `rep_email` directly from `Opportunity Owner Email` — no `rep_mapping` lookup needed here
- **Do not update `close_date`** — it is not in the SF report; it comes from the contacts CSV only
- Diff each field against the current `opportunities` row. On any change: update the row, set `last_sf_sync_at = now()`, insert an `activity_log` row with `source: sf_report` and `notes` describing what changed
- Stage changes feed immediately into cadence evaluation (step 6)

#### Step 2 — Gmail scan
- Query Gmail for all messages in the last 24 hours (or since `rep_tokens.last_scan_at`) sent to or received from any email address in `contacts` linked to this rep's opportunities
  - Join: `opportunities` (where `rep_email = this rep`) → `opportunity_contacts` → `contacts.email`
- For each matched message, insert an `activity_log` row
  - Distinguish `email_sent` (rep is sender) vs. `email_received` vs. `reply_received` (reply to a prior outbound)

#### Step 3 — Gong detection
- Search Gmail for Gong call summary notification emails (identify by sender domain / subject pattern — **format is unverified, must test with real inbox before hardcoding**)
- Parse: account name, call date, summary text
- Match account name to `opportunities.account_name` for this rep
- Insert `activity_log` row with `activity_type: gong_call`, `notes: <summary>`
- If `cadence_rules.auto_followup_on_meeting = true` for this opportunity's stage: call the AI drafting function and create a Gmail draft with collateral attached (see `docs/ai.md`)

#### Step 4 — Calendar check
- Pull today's and tomorrow's calendar events via Google Calendar API
- For each event, check if any attendee email matches `contacts.email` for this rep's opportunities
- Log completed past meetings as `activity_log` with `activity_type: meeting_held`
- Apply same auto-follow-up logic as step 3

#### Step 5 — Draft status check
- Query Gmail drafts for any AI-generated outreach (identify by a label or subject prefix set during draft creation)
- Flag unsent drafts — include in the Slack digest

#### Step 6 — Cadence evaluation
- For each of this rep's active opportunities:
  - Find the most recent `activity_log` row for that opportunity
  - Calculate days since last touch
  - Compare against `cadence_rules.days_between_touches` for the opportunity's current `stage_name`
  - If overdue: mark as needing follow-up in the digest

#### Step 7 — Slack DM digest
Post a formatted Slack DM to the rep. See `docs/slack.md` for format.

After successful completion, update `rep_tokens.last_scan_at = now()`.

---

### `weekly-meeting-scan`

**Trigger:** Cron, Mondays at 8am ET

**What it does (per rep, all reps in parallel):**

1. Pull all Google Calendar events for the upcoming 7 days
2. For each event, match attendee emails against `contacts.email`
3. Upsert matching events into `upcoming_meetings` with `inferred_type`. Infer by matching the calendar event title (case-insensitive): "intro" → `intro`, "meeting" → `meeting` (these are demos — reps name demo calls "Meeting" in GCal), "proposal" → `proposal`, "next steps" → `next_steps`, "catch" → `catch_up`. No keyword match → `unknown`.
4. Detect stage progression: if a rep had an intro meeting last week (from `activity_log`) and now has a `meeting` or `proposal` scheduled, set `stage_progression_detected = true`
5. For progression events: call AI drafting to create a value-add between-meeting touchpoint as a Gmail draft (with relevant collateral attached). Set `touchpoint_drafted = true`
6. For any upcoming meeting with no prep email logged in `activity_log`:
   - Create a Gmail draft with pre-meeting materials (agenda, relevant case study)
   - Add a 30-minute prep calendar block the day before via Google Calendar API (`calendar.events` scope)

---

### `arsenal-create-link`

**Trigger:** HTTP POST, rep JWT required

**Request:** `{ itemId: string, prospectEmail?: string }`

**Response:** `{ slug: string }` (200), or `{ error }` (400/401/403/404/500)

**What it does:**
1. Verifies the caller can read the item: `visibility = 'global'` OR `visibility = 'private' AND owner_email = caller`. Returns 403 otherwise, 404 if the item is missing or inactive.
2. Dedupes: if an active `collateral_links` row already exists for `(item_id, rep_email, prospect_email)`, returns that slug — no insert.
3. Otherwise generates an 8-char base62 slug via `crypto.getRandomValues` and inserts. Retries up to 3 times on `23505` unique-violation (slug collision); any other error bails immediately.

### `arsenal-stats`

**Trigger:** HTTP GET, rep JWT required

**Request:** query `?itemIds=a,b,c` (comma-separated)

**Response:** `{ [itemId]: { openCount: number, lastOpenedAt: string | null, linkSlug: string | null } }`

**What it does:**
- Queries `collateral_links` embedded with `collateral_events` for the caller's active links, filtered to the requested `item_id`s.
- Applies the bot-filter from `_shared/bot-filter.ts` (26 UA patterns including Googlebot, Slackbot, safelinks, curl, headlessChrome, etc.) at read time — events are filtered before counting.
- Items with no link or no human events return `{ openCount: 0, lastOpenedAt: null, linkSlug: null }`.

### `arsenal-upload-url`

**Trigger:** HTTP POST, rep JWT required (admin further enforced for `scope=global`)

**Request:** `{ filename: string, scope: 'global' | 'private' }`

**Response:** `{ uploadUrl: string, token: string, path: string }`

**What it does:**
1. For `scope=global`, looks up `rep_mapping.is_admin` for the caller and returns 403 if not admin. Note the admin gate is the DB column, not the `app.admin_emails` env var used elsewhere.
2. Sanitizes the filename (`/[^a-zA-Z0-9._-]/g → _`) and namespaces with `crypto.randomUUID()`, yielding `global/{uuid}-{safe}` or `private/{caller-email}/{uuid}-{safe}`.
3. Returns a Supabase Storage signed upload URL via `storage.from('arsenal').createSignedUploadUrl(key)` — the client PUTs the bytes directly to Storage.

---

## Modified functions

### `create-gmail-draft` (v9)

- `contactId` and `opportunityId` are now **optional** — this supports the Arsenal-send path, which sends trackable collateral not tied to a specific opportunity.
- `activity_log` insert is skipped when either ID is missing.
- `attachments` accepts a union per entry: `{ storageKey, filename }` (Supabase Storage, existing) OR `{ driveFileId, filename? }` (Google Drive). Drive entries are fetched via `_shared/drive-download.ts`, which handles Google-native exports (Docs → PDF, Slides → PDF, Sheets → CSV) and binary files via `?alt=media`.
- Failed downloads are collected into a `failedAttachments` array on the response rather than aborting the whole draft.

### `ingest-metabase` (v7)

After a successful CSV parse and **before** the knowledge upsert, uploads the raw CSV to `arsenal/global/metabase/{reportSlug}-{YYYY-MM-DD}.csv` (`upsert: true`) and upserts a `type='report'` row in `arsenal_items` keyed by `storage_path`. Snapshot failure is **non-fatal** — the knowledge ingest still runs.

Response shape gains `arsenalSnapshot: { path, status: 'created' | 'updated' | 'skipped', itemId?, error? }`.

The resulting `arsenal_items.id` is merged into each `knowledge_base` row's `metadata` as `arsenal_item_id`, so downstream retrievers (and Claude) can trace which Metabase snapshot a retrieved insight came from.

---

## Calendar write actions (used by both functions)

With `calendar.events` scope, the system can create events. These are used to:
- Add 30-min prep blocks before scheduled meetings (weekly scan)
- Create follow-up reminder events after detected meetings (daily scan, on `auto_followup_on_meeting` trigger)
- Schedule 15-min outreach windows for overdue contacts (daily scan, when cadence threshold exceeded)

Always check that a prep block or follow-up event doesn't already exist before creating a duplicate.

---

## Environment variables required

See `docs/infrastructure.md` for the full list of secrets needed by each function.
