# Database

Supabase project ref: `hjxaqhbkdvckapsqvqcq` (configured in `.mcp.json`).

Always verify live schema via `mcp__supabase__list_tables` / `mcp__supabase__execute_sql` before writing queries or migrations. The schema below reflects intent at design time; the live DB is authoritative.

---

## Data model overview

The model is **opportunity-centric**. In Salesforce, reps own opportunities, not contacts. A single opportunity (e.g., "Acme Co") may have multiple contacts (CEO, VP Ops, Procurement Lead). The rep-to-contact mapping flows through the opportunity. The CSV contains ~4,290 unique opportunities across ~8,003 contact rows.

---

## Tables

### `opportunities`

Core entity. Imported from SF CSV; updated daily by SF report email parsing.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| sf_opportunity_id | text unique | CSV `opportunity_id` |
| sf_account_id | text | CSV `account_id` |
| account_name | text | |
| manufacturer_id | text | |
| opportunity_name | text | |
| opp_owner | text | SF display name (e.g. "Wesley Phillips") |
| rep_email | text | set from `Opportunity Owner Email` in SF report; falls back to `rep_mapping` lookup on CSV import |
| stage_name | text | updated by SF report email parse |
| close_date | date | from CSV (SF report does not include close_date) |
| amount | numeric | updated by SF report email parse |
| next_step | text | updated by SF report email parse |
| next_steps_c | text | from CSV |
| description | text | from CSV |
| categories | text | from SF report `Categories` (comma-separated product categories) |
| company_category | text | from SF report `Company Category` (e.g. "Contract Manufacturer") |
| last_sf_sync_at | timestamptz | when SF report email last updated this row |
| created_at | timestamptz | auto |
| updated_at | timestamptz | auto |

### `contacts`

People associated with opportunities. A contact can appear on multiple opportunities (rare; ~16 cases in current data).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| sf_contact_id | text unique | CSV `id` field |
| first_name | text | |
| last_name | text | |
| email | text | used for Gmail/Calendar matching |
| title | text | |
| created_at | timestamptz | auto |

### `opportunity_contacts`

Join table. PK is composite `(opportunity_id, contact_id)`.

| Column | Type | Notes |
|--------|------|-------|
| opportunity_id | uuid FK | → opportunities |
| contact_id | uuid FK | → contacts |
| primary | boolean | first contact listed for the opp |

### `rep_mapping`

Maps SF display names to Google accounts. Must be pre-populated with all 37 SF display names before any scan runs. Without this, `opportunities.rep_email` will be null and reps won't receive digests.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| sf_display_name | text unique | exact string from CSV `Opp Owner` |
| rep_email | text unique | @keychain.com Google account |
| rep_name | text | display name for Slack/frontend |
| is_active | boolean | false for departed reps; skip in scans |

### `activity_log`

Every detected or manually logged outreach touch. Logged against the opportunity; contact_id is nullable (not always identifiable from email sender).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| opportunity_id | uuid FK | which deal this relates to |
| contact_id | uuid FK nullable | specific contact, if identifiable |
| rep_email | text | rep's @keychain.com email |
| activity_type | enum | see values below |
| activity_date | timestamptz | when it happened |
| subject | text | email subject or meeting title |
| notes | text | optional (Gong summary, research snippet, meeting notes) |
| draft_copy | text | AI-drafted copy, if applicable |
| source | enum | see values below |
| created_at | timestamptz | auto |

`activity_type` values: `email_sent`, `email_received`, `reply_received`, `meeting_held`, `meeting_scheduled`, `collateral_shared`, `gong_call`, `manual_log`, `post_meeting_followup`

`source` values: `gmail_scan`, `calendar_scan`, `gong_detection`, `sf_report`, `slack_log`, `manual`

### `cadence_rules`

One row per SF stage name. Configurable thresholds that drive the cadence evaluation step.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| stage_name | text | must match SF stage name exactly |
| days_between_touches | int | trigger reminder after this many days |
| max_attempts | int | stop alerting after N unreturned outreach attempts |
| auto_followup_on_meeting | boolean | if true, immediately draft follow-up when meeting/Gong call detected |
| suggested_action | text | e.g. "Send follow-up email", "Try phone call" |
| outreach_template_key | text | which email style to use for AI drafting |

**Default rows to seed:**

| stage_name | days_between_touches | max_attempts | auto_followup_on_meeting |
|---|---|---|---|
| Scheduling First Call | 3 | 5 | false |
| Revival | 4 | 4 | false |
| First Call Scheduled | 2 | 2 | false |
| First Meeting Completed | 1 | 3 | true |
| Second Call Scheduled | 2 | 2 | false |
| Second Meeting Completed | 1 | 3 | true |
| Proposal Meeting Scheduled | 2 | 2 | false |
| Proposal Sent | 2 | 6 | true |
| Next Steps Scheduled | 2 | 2 | false |
| Next Steps Completed | 2 | 4 | true |
| Service Agreement Sent | 2 | 6 | false |

### `upcoming_meetings`

Populated (upserted) by the weekly Monday cron. One row per matched meeting.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| opportunity_id | uuid FK | matched opportunity |
| contact_id | uuid FK nullable | matched contact, if identifiable |
| rep_email | text | |
| meeting_title | text | from calendar event |
| meeting_date | timestamptz | |
| attendees | jsonb | list of attendee emails |
| inferred_type | enum | `intro`, `meeting`, `proposal`, `next_steps`, `catch_up`, `unknown` |
| stage_progression_detected | boolean | true if this represents deal advancement |
| touchpoint_drafted | boolean | whether a between-meeting draft was generated |
| followup_drafted | boolean | whether a post-meeting follow-up was generated |
| created_at | timestamptz | auto |

### `rep_tokens`

Google OAuth credentials per rep. **Refresh tokens are stored encrypted via Supabase Vault — never in plaintext columns.**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| rep_email | text unique | @keychain.com email |
| rep_name | text | display name |
| google_refresh_token | text | encrypted via Vault |
| scopes | text[] | granted OAuth scopes |
| last_scan_at | timestamptz | updated after each successful daily scan |
| is_active | boolean | false = skip in scans (no need to delete) |
| created_at | timestamptz | auto |

### `collateral`

Content and marketing pieces available to attach to Gmail drafts. Populated manually or via admin upload. The AI drafting engine selects relevant pieces by matching `stage_names` and `tags` to the opportunity's context.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| title | text | display name of the piece |
| description | text | brief summary for AI context |
| file_url | text | link to the stored file (Google Drive, etc.) |
| type | text | `case_study`, `one_pager`, `deck`, `data_sheet`, `template` |
| stage_names | text[] | SF stage names this piece is relevant for; empty = all stages |
| tags | text[] | free-form tags: industry, category, use case — used by AI for matching |
| is_active | boolean | false = exclude from drafting engine |
| created_at | timestamptz | auto |
| updated_at | timestamptz | auto |

### `supplier_stats`

Metabase category search data per manufacturer. Joined to `opportunities` on `manufacturer_name ≈ account_name` (text match, not a FK — names may have minor variations). Updated periodically via CSV upload from Metabase.

The AI drafting engine uses this data to personalize outreach with category-specific search volume stats (e.g., "there are X buyers actively searching in your category on Keychain right now").

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| manufacturer_name | text unique | matches `opportunities.account_name` |
| tagged_micro_cat_projects_last_365_days | int | buyer projects in tagged categories (365 days) |
| tagged_micro_cat_projects_last_90_days | int | buyer projects in tagged categories (90 days) |
| tagged_micro_cat_verified_projects_last_365_days | int | verified projects only (365 days) |
| tagged_micro_cat_verified_projects_last_90_days | int | verified projects only (90 days) |
| tagged_micro_cat_views_last_365_days | int | category page views (365 days) |
| tagged_micro_cat_views_last_90_days | int | category page views (90 days) |
| updated_at | timestamptz | when this row was last imported from Metabase |
| created_at | timestamptz | auto |

---

## Migrations

Use `mcp__supabase__apply_migration` to run DDL. Use `mcp__supabase__list_migrations` to check applied migrations before adding new ones. Name migrations descriptively: `001_initial_schema`, `002_seed_cadence_rules`, etc.
