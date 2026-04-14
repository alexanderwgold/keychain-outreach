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
- Parse the HTML table or CSV attachment for: Opportunity Name, Stage, Close Date, Amount, Next Step
- Diff each field against the current `opportunities` row
- On any change: update the `opportunities` row, set `last_sf_sync_at = now()`, insert an `activity_log` row with `source: sf_report` and `notes` describing what changed
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
3. Upsert matching events into `upcoming_meetings` with `inferred_type` (infer from meeting title keywords: "intro", "demo", "proposal", "negotiation", "check-in")
4. Detect stage progression: if a rep had an intro meeting last week (from `activity_log`) and now has a demo scheduled, set `stage_progression_detected = true`
5. For progression events: call AI drafting to create a value-add between-meeting touchpoint as a Gmail draft (with relevant collateral attached). Set `touchpoint_drafted = true`
6. For any upcoming meeting with no prep email logged in `activity_log`:
   - Create a Gmail draft with pre-meeting materials (agenda, relevant case study)
   - Add a 30-minute prep calendar block the day before via Google Calendar API (`calendar.events` scope)

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
