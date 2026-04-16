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
