# Day 1 Implementation Plan: Database Schema & Backend Configuration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the complete Supabase schema, seed all reference data, deploy the CSV import Edge Function, and store Google OAuth credentials — so Day 2 can begin with a working, data-populated backend.

**Architecture:** Supabase Postgres is the source of truth. Edge Functions (Deno) handle server-side logic. Google OAuth credentials are stored as Supabase Edge Function secrets. Refresh tokens are stored encrypted in Supabase Vault (never plaintext).

**Tech Stack:** Supabase (Postgres 15, Edge Functions, Vault), Deno 1.40+, Google Cloud OAuth 2.0

---

## Sub-plans (execute in dependency order)

| Plan | What it produces | Estimated steps |
|------|-----------------|-----------------|
| [A: Database Schema](2026-04-14-day1-A-database-schema.md) | All 10 tables, 3 enum types, indexes, RLS enabled | 4 tasks |
| [B: Seed Data](2026-04-14-day1-B-seed-data.md) | 11 cadence rules + 37 rep_mapping rows | 4 tasks |
| [C: CSV Import Function](2026-04-14-day1-C-csv-import.md) | Deployed `csv-import` Edge Function, full CSV loaded into DB | 10 tasks |
| [D: Google OAuth Setup](2026-04-14-day1-D-google-oauth.md) | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` stored as secrets | 5 tasks |

## Parallel SF admin task (requires Salesforce admin access)

This runs in parallel with Plans A–D and does not require any code:

- [ ] In Salesforce: create a scheduled report for each rep with columns: Opportunity Name, Amount, Account Name, Stage, Stage Duration, Next Step, Company Category, Industry, Square Footage, Categories, Last Activity, Account Type, Fiscal Period, Probability (%), Opportunity Owner, Opportunity Owner Email, Opportunity ID (open opportunities only, filtered by Opp Owner = each rep)
- [ ] Schedule the report to email each rep daily at **2:00pm ET** (so it arrives before the 3:30pm daily scan)
- [ ] Confirm the sender will be `reports@salesforce.com` and note the exact subject line — the daily scan uses both to identify the email (exact format verified during Day 2 testing)

This is a prerequisite for the SF report email sync step in the Day 2 daily-scan function. Without it, stage changes won't be detected automatically and the system will fall back to manual CSV re-uploads.

---

## Execution order and dependencies

```
A (schema) → B (seed data) → C (CSV import)
D (Google OAuth) — independent, can run in parallel with A–C
```

- **A before B**: seed migrations reference the tables from A
- **A before C**: Edge Function writes to these tables
- **B before C's integration test**: needs `rep_mapping` populated to resolve `opp_owner → rep_email`
- **D is independent**: set up Google credentials any time during Day 1

## File structure produced by this plan

```
supabase/
  migrations/
    001_initial_schema.sql        — enums + all 10 tables
    002_rls_and_indexes.sql       — indexes, updated_at trigger, RLS
    003_seed_cadence_rules.sql    — 11 default cadence rule rows
    004_seed_rep_mapping.sql      — 37 rep display-name → email mappings
  functions/
    _shared/
      supabase-client.ts          — shared admin Supabase client factory
    csv-import/
      index.ts                    — HTTP handler (multipart form, auth check)
      parse.ts                    — CSV text → typed ParsedRow[]
      parse.test.ts               — unit tests for parse.ts
      upsert.ts                   — batch upsert contacts, opportunities, links
```

## Day 1 completion checklist

Run these after all 4 sub-plans complete:

- [ ] `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;` returns 10 rows
- [ ] `SELECT count(*) FROM cadence_rules;` returns 11
- [ ] `SELECT count(*) FROM rep_mapping WHERE is_active = true;` returns 36 (37 minus 'Partnerships')
- [ ] `curl -X POST https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/csv-import -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -F "file=@sample.csv"` returns `{"rowsProcessed":N,...,"unmatchedOwners":[]}`
- [ ] After full CSV import: `SELECT count(*) FROM opportunities;` ≈ 4,290 and `SELECT count(*) FROM contacts;` ≈ 8,003
- [ ] Supabase Dashboard → Project Settings → Edge Functions → Secrets shows `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
