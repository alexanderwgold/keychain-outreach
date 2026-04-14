# Day 1-A: Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply two migrations that create all 8 production tables, 3 custom enum types, performance indexes, an `updated_at` trigger, and row-level security on every table.

**Architecture:** All DDL runs via `mcp__supabase__apply_migration`. Migration SQL is also saved to `supabase/migrations/` for git history. Edge Functions use the service-role key, which bypasses RLS automatically — no user-facing policies are needed until Day 3 (frontend auth).

**Tech Stack:** Supabase Postgres 15, Supabase MCP (`mcp__supabase__apply_migration`, `mcp__supabase__execute_sql`)

---

## Files

| Action | Path |
|--------|------|
| Create | `supabase/migrations/001_initial_schema.sql` |
| Create | `supabase/migrations/002_rls_and_indexes.sql` |

---

### Task 1: Confirm the database is empty

- [ ] **Step 1: Verify no tables exist yet**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public';
```

Expected output: `table_count = 0`

If the count is non-zero, stop and check `mcp__supabase__list_tables` to understand what's already there before proceeding.

---

### Task 2: Create migration file 001 and apply it

- [ ] **Step 1: Create the migration file**

Write the following SQL to `supabase/migrations/001_initial_schema.sql`:

```sql
-- ============================================================
-- Migration 001: Initial schema
-- Creates 3 enum types and all 8 tables.
-- Table order respects FK dependencies.
-- ============================================================

-- ----- ENUM TYPES -----

-- Values for activity_log.activity_type
create type activity_type as enum (
  'email_sent',
  'email_received',
  'reply_received',
  'meeting_held',
  'meeting_scheduled',
  'collateral_shared',
  'gong_call',
  'manual_log',
  'post_meeting_followup'
);

-- Values for activity_log.source
create type activity_source as enum (
  'gmail_scan',
  'calendar_scan',
  'gong_detection',
  'sf_report',
  'slack_log',
  'manual'
);

-- Values for upcoming_meetings.inferred_type
create type meeting_type as enum (
  'intro',
  'meeting',
  'proposal',
  'next_steps',
  'catch_up',
  'unknown'
);

-- ----- TABLES (in FK dependency order) -----

-- rep_mapping: no FK dependencies
-- Maps Salesforce display names to @keychain.com Google accounts.
-- Must be seeded before CSV import (opportunities resolve rep_email via this table).
create table rep_mapping (
  id              uuid        primary key default gen_random_uuid(),
  sf_display_name text        unique not null,
  rep_email       text        unique not null,
  rep_name        text        not null,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now()
);

-- contacts: no FK dependencies
-- People associated with opportunities. email is nullable (some SF contacts have none).
create table contacts (
  id            uuid        primary key default gen_random_uuid(),
  sf_contact_id text        unique not null,
  first_name    text        not null,
  last_name     text        not null,
  email         text,
  title         text,
  created_at    timestamptz not null default now()
);

-- cadence_rules: no FK dependencies
-- One row per SF stage name. Drives cadence evaluation in the daily scan.
create table cadence_rules (
  id                       uuid    primary key default gen_random_uuid(),
  stage_name               text    unique not null,
  days_between_touches     int     not null,
  max_attempts             int     not null,
  auto_followup_on_meeting boolean not null default false,
  suggested_action         text,
  outreach_template_key    text
);

-- collateral: content and marketing pieces used in outreach drafts.
-- Populated manually or via admin upload. The AI drafting engine selects
-- relevant pieces by matching stage_names and tags to attach to Gmail drafts.
create table collateral (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null,
  description text,
  file_url    text,
  type        text,        -- 'case_study', 'one_pager', 'deck', 'data_sheet', 'template'
  stage_names text[],     -- SF stage names this piece is relevant for (empty = all stages)
  tags        text[],     -- free-form tags: industry, category, use case (for AI matching)
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- supplier_stats: Metabase category search data per manufacturer.
-- Joined to opportunities on manufacturer_name ≈ account_name (text match, not FK).
-- Updated periodically via CSV upload from Metabase.
create table supplier_stats (
  id                                               uuid        primary key default gen_random_uuid(),
  manufacturer_name                                text        unique not null,
  tagged_micro_cat_projects_last_365_days          int,
  tagged_micro_cat_projects_last_90_days           int,
  tagged_micro_cat_verified_projects_last_365_days int,
  tagged_micro_cat_verified_projects_last_90_days  int,
  tagged_micro_cat_views_last_365_days             int,
  tagged_micro_cat_views_last_90_days              int,
  updated_at                                       timestamptz not null default now(),
  created_at                                       timestamptz not null default now()
);

-- rep_tokens: no FK dependencies
-- Google OAuth credentials per rep. google_refresh_token stores a Vault secret ID
-- (UUID), NOT the raw token. See docs/auth.md for the Vault read/write pattern.
create table rep_tokens (
  id                   uuid        primary key default gen_random_uuid(),
  rep_email            text        unique not null,
  rep_name             text        not null,
  google_refresh_token text,
  scopes               text[],
  last_scan_at         timestamptz,
  is_active            boolean     not null default true,
  created_at           timestamptz not null default now()
);

-- opportunities: no FK constraints (rep_email is a plain text ref to rep_mapping,
-- not a FK, so null rep_email is allowed when opp_owner has no rep_mapping entry).
create table opportunities (
  id                uuid        primary key default gen_random_uuid(),
  sf_opportunity_id text        unique not null,
  sf_account_id     text,
  account_name      text        not null,
  manufacturer_id   text,
  opportunity_name  text        not null,
  opp_owner         text        not null,
  rep_email         text,
  stage_name        text,
  close_date        date,
  amount            numeric,
  next_step         text,
  next_steps_c      text,
  description       text,
  categories        text,        -- from SF report "Categories" (comma-separated product categories)
  company_category  text,        -- from SF report "Company Category" (e.g. "Contract Manufacturer")
  last_sf_sync_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- opportunity_contacts: FK to opportunities + contacts
-- "primary" is a reserved SQL keyword — always quote it in queries.
create table opportunity_contacts (
  opportunity_id uuid    not null references opportunities(id) on delete cascade,
  contact_id     uuid    not null references contacts(id)      on delete cascade,
  "primary"      boolean not null default false,
  primary key (opportunity_id, contact_id)
);

-- activity_log: FK to opportunities (required) + contacts (nullable)
create table activity_log (
  id             uuid            primary key default gen_random_uuid(),
  opportunity_id uuid            not null references opportunities(id) on delete cascade,
  contact_id     uuid            references contacts(id) on delete set null,
  rep_email      text            not null,
  activity_type  activity_type   not null,
  activity_date  timestamptz     not null,
  subject        text,
  notes          text,
  draft_copy     text,
  source         activity_source not null,
  created_at     timestamptz     not null default now()
);

-- upcoming_meetings: FK to opportunities (required) + contacts (nullable)
create table upcoming_meetings (
  id                         uuid         primary key default gen_random_uuid(),
  opportunity_id             uuid         not null references opportunities(id) on delete cascade,
  contact_id                 uuid         references contacts(id) on delete set null,
  rep_email                  text         not null,
  meeting_title              text,
  meeting_date               timestamptz  not null,
  attendees                  jsonb        not null default '[]'::jsonb,
  inferred_type              meeting_type not null default 'unknown',
  stage_progression_detected boolean      not null default false,
  touchpoint_drafted         boolean      not null default false,
  followup_drafted           boolean      not null default false,
  created_at                 timestamptz  not null default now()
);
```

- [ ] **Step 2: Apply the migration**

Run via `mcp__supabase__apply_migration`:
- `name`: `"001_initial_schema"`
- `query`: the full SQL from Step 1

Expected: no error returned.

- [ ] **Step 3: Verify all 10 tables were created**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected output — exactly these 10 rows:
```
activity_log
cadence_rules
collateral
contacts
opportunity_contacts
opportunities
rep_mapping
rep_tokens
supplier_stats
upcoming_meetings
```

- [ ] **Step 4: Verify all 3 enum types were created**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT typname
FROM pg_type
WHERE typtype = 'e'
ORDER BY typname;
```

Expected output — exactly these 3 rows:
```
activity_source
activity_type
meeting_type
```

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/migrations/001_initial_schema.sql
git commit -m "feat: add initial schema with 10 tables and enum types"
```

---

### Task 3: Create migration 002 and apply it

- [ ] **Step 1: Create the migration file**

Write the following SQL to `supabase/migrations/002_rls_and_indexes.sql`:

```sql
-- ============================================================
-- Migration 002: Indexes, updated_at trigger, and RLS
-- ============================================================

-- ----- INDEXES -----

-- opportunities: queried by rep_email (daily scan per-rep lookup)
-- and stage_name (cadence evaluation)
create index idx_opportunities_rep_email  on opportunities(rep_email);
create index idx_opportunities_stage_name on opportunities(stage_name);

-- activity_log: queried by opportunity_id (cadence eval) and sorted by
-- activity_date desc (most recent touch calculation)
create index idx_activity_log_opportunity_id on activity_log(opportunity_id);
create index idx_activity_log_activity_date  on activity_log(activity_date desc);
create index idx_activity_log_rep_email      on activity_log(rep_email);

-- contacts: matched by email during Gmail scan and Calendar scan
create index idx_contacts_email on contacts(email);

-- upcoming_meetings: queried by rep_email in weekly scan
create index idx_upcoming_meetings_rep_email on upcoming_meetings(rep_email);

-- supplier_stats: joined to opportunities by name for AI personalization lookups
create index idx_supplier_stats_manufacturer_name on supplier_stats(manufacturer_name);

-- ----- UPDATED_AT TRIGGER -----

-- Automatically sets updated_at = now() on every UPDATE for tables that have it.
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger opportunities_updated_at
  before update on opportunities
  for each row execute function update_updated_at();

create trigger collateral_updated_at
  before update on collateral
  for each row execute function update_updated_at();

create trigger supplier_stats_updated_at
  before update on supplier_stats
  for each row execute function update_updated_at();

-- ----- ROW LEVEL SECURITY -----

-- Enable RLS on all 10 tables.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS automatically.
-- User-facing select/insert policies are added in Day 3 when frontend auth is wired.
alter table opportunities        enable row level security;
alter table contacts             enable row level security;
alter table opportunity_contacts enable row level security;
alter table rep_mapping          enable row level security;
alter table activity_log         enable row level security;
alter table cadence_rules        enable row level security;
alter table upcoming_meetings    enable row level security;
alter table rep_tokens           enable row level security;
alter table collateral           enable row level security;
alter table supplier_stats       enable row level security;
```

- [ ] **Step 2: Apply the migration**

Run via `mcp__supabase__apply_migration`:
- `name`: `"002_rls_and_indexes"`
- `query`: the full SQL from Step 1

Expected: no error returned.

- [ ] **Step 3: Verify indexes were created**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
```

Expected output — 8 rows:
```
idx_activity_log_activity_date          | activity_log
idx_activity_log_opportunity_id         | activity_log
idx_activity_log_rep_email              | activity_log
idx_contacts_email                      | contacts
idx_upcoming_meetings_rep_email         | upcoming_meetings
idx_opportunities_rep_email             | opportunities
idx_opportunities_stage_name            | opportunities
idx_supplier_stats_manufacturer_name    | supplier_stats
```

- [ ] **Step 4: Verify RLS is enabled on all tables**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected output — all 10 tables have `rowsecurity = true`:
```
activity_log         | true
cadence_rules        | true
collateral           | true
contacts             | true
opportunity_contacts | true
opportunities        | true
rep_mapping          | true
rep_tokens           | true
supplier_stats       | true
upcoming_meetings    | true
```

- [ ] **Step 5: Verify the updated_at trigger exists**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public';
```

Expected: 3 rows:
```
collateral_updated_at      | UPDATE | collateral
opportunities_updated_at   | UPDATE | opportunities
supplier_stats_updated_at  | UPDATE | supplier_stats
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/002_rls_and_indexes.sql
git commit -m "feat: add indexes, updated_at trigger, and RLS to all tables"
```

---

### Task 4: Verify Vault is available

Supabase Vault is pre-enabled on all hosted Supabase projects, but confirm before Day 2 auth work depends on it.

- [ ] **Step 1: Check that the vault schema and function exist**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'vault'
ORDER BY routine_name;
```

Expected: at least one row containing `create_secret`. If the vault schema is missing entirely, go to Supabase Dashboard → Database → Extensions → search "vault" → Enable.

- [ ] **Step 2: Confirm vault.decrypted_secrets view exists**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'vault';
```

Expected: `decrypted_secrets` appears in the result.

If either check fails, stop and enable the Vault extension via the Supabase Dashboard before continuing to Plan B or C.

---

### Plan A complete

All 10 tables, 3 enums, 8 indexes, 3 triggers, and RLS are in place. Proceed to [Plan B: Seed Data](2026-04-14-day1-B-seed-data.md).
