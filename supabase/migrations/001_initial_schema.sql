-- ============================================================
-- Migration 001: Initial schema
-- Creates 3 enum types and all 10 tables.
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
