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

### `arsenal_items`

Library of shareable content — reference links, collateral (decks, case studies), and internal Metabase report snapshots. `visibility = 'global'` items are admin-curated and readable by every rep; `visibility = 'private'` items belong to a single rep. The `owner_email_required_for_private` CHECK constraint enforces that `owner_email` is set iff private, and null iff global.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| visibility | text | `global` or `private` (CHECK) |
| owner_email | text FK nullable | → `rep_tokens.rep_email`, required for private, null for global |
| type | text | `reference`, `collateral`, or `report` (CHECK) |
| title | text | |
| description | text | default `''` |
| url | text | NOT NULL; for `storage_path` items this is the `getPublicUrl` result — the `/c/[slug]` handler generates a signed URL at redirect time |
| storage_path | text nullable | object key inside the `arsenal` Storage bucket |
| thumbnail_url | text nullable | |
| tags | text[] | default `{}` |
| sort_order | int | default `0` |
| active | boolean | default `true`; soft-delete via `active=false` to preserve historical trackable links |
| created_by | text | NOT NULL; `@keychain.com` email of the creator, or `system@keychain.com` for snapshots |
| created_at | timestamptz | auto |
| updated_at | timestamptz | auto via `update_arsenal_items_updated_at` trigger |

**Indexes:** partial `(visibility, type) WHERE active`; partial `(owner_email, type) WHERE active`; GIN on `tags`.

### `collateral_links`

Per-rep, per-prospect trackable short URL pointing at an `arsenal_items` row. One active slug per `(item_id, rep_email, prospect_email)` triple; NULL prospect gets its own slot.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto |
| slug | text unique | 8-char base62, generated by `arsenal-create-link` |
| item_id | uuid FK | → `arsenal_items` ON DELETE CASCADE |
| rep_email | text FK | → `rep_tokens.rep_email` ON DELETE CASCADE |
| prospect_email | text nullable | |
| active | boolean | default `true` |
| created_at | timestamptz | auto |

**Indexes:** UNIQUE partial `(item_id, rep_email, COALESCE(prospect_email, '')) WHERE active` — this is what `arsenal-create-link` relies on for dedupe.

### `collateral_events`

One row per open event, inserted unconditionally by the `/c/[slug]` redirect handler. Bot traffic is filtered at **read** time by `arsenal-stats` (via `_shared/bot-filter.ts`), not at write time — this keeps the redirect path fast and auditable.

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial PK | auto |
| link_id | uuid FK | → `collateral_links` ON DELETE CASCADE |
| event_type | text | `opened` or `downloaded` (CHECK); only `opened` emitted in v1 |
| user_agent | text nullable | raw UA string |
| ip_prefix | text nullable | `/24` for IPv4, `/48` for IPv6 (not full IP) |
| referrer | text nullable | |
| created_at | timestamptz | auto |

**Indexes:** `(link_id, created_at desc)`.

### Arsenal RLS (migration `013_arsenal_rls.sql`)

11 policies total. All checks use `(auth.jwt() ->> 'email')` for the caller and `is_admin()` for admin overrides.

- **`arsenal_items`** (7 policies) — SELECT: global OR owner; INSERT: admin→global, rep→own private (`owner_email = created_by = caller`); UPDATE/DELETE: admin→global, owner→own private.
- **`collateral_links`** (3 policies) — SELECT: `rep_email = caller` OR admin; INSERT: `rep_email = caller`; UPDATE: `rep_email = caller`.
- **`collateral_events`** (1 policy) — SELECT: scoped via link ownership (caller owns the link, or admin). **No INSERT policy** — inserts happen via service-role client only (the `/c/[slug]` Node route).

### Arsenal Storage bucket (migration `014_arsenal_storage.sql`)

Private bucket `arsenal` with `file_size_limit = 52428800` (50 MB) and `allowed_mime_types = ['application/pdf', 'text/csv', 'image/png', 'image/jpeg']`. `public = false` — see the private-bucket note below.

5 RLS policies on `storage.objects`:

- SELECT: `bucket_id = 'arsenal' AND auth.role() = 'authenticated'`
- INSERT admin under `global/…`
- INSERT rep under `private/{their-email}/…`
- DELETE admin under `global/…`
- DELETE rep under `private/{their-email}/…`

There are no UPDATE policies — overwrites go through signed upload URLs, and edits are handled by deleting + re-inserting.

**Private-bucket note:** because the bucket is private, `arsenal_items.url` stored via `getPublicUrl(path)` will 404 on direct fetch. The `/c/[slug]` redirect handler detects a non-null `storage_path` and generates a 5-minute signed URL via `createSignedUrl(path, 300)` before redirecting.

---

## Migrations

Use `mcp__supabase__apply_migration` to run DDL. Use `mcp__supabase__list_migrations` to check applied migrations before adding new ones. Name migrations descriptively: `001_initial_schema`, `002_seed_cadence_rules`, etc.
