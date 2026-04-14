# Day 1-B: Seed Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `cadence_rules` with 11 default rows and `rep_mapping` with all 37 Salesforce display names mapped to @keychain.com email addresses.

**Architecture:** Two migrations applied via `mcp__supabase__apply_migration`. The `rep_mapping` migration contains email addresses guessed using the `first.last@keychain.com` convention — **every email must be verified against actual Google Workspace accounts before any scan runs.** Unverified emails cause opportunities to silently fail rep assignment.

**Tech Stack:** Supabase MCP (`mcp__supabase__apply_migration`, `mcp__supabase__execute_sql`)

**Prerequisite:** Plan A (schema) must be complete.

---

## Files

| Action | Path |
|--------|------|
| Create | `supabase/migrations/003_seed_cadence_rules.sql` |
| Create | `supabase/migrations/004_seed_rep_mapping.sql` |

---

### Task 1: Seed cadence rules

- [ ] **Step 0: Pre-migration compliance audit**

Before applying the migration, run the **Supabase compliance auditor** agent (`subagent_type: "supabase-compliance-auditor"`) to validate the seed SQL against the live schema. The agent should:

1. Confirm the `cadence_rules` table exists and has the expected columns: `stage_name`, `days_between_touches`, `max_attempts`, `auto_followup_on_meeting`, `suggested_action`, `outreach_template_key`
2. Confirm column types match the INSERT values (text, int, boolean, text, text)
3. Confirm no RLS policies block service-role inserts
4. Flag any column name mismatches or missing columns before the migration runs

If the auditor finds issues, fix the migration SQL before proceeding to Step 1.

- [ ] **Step 1: Create the migration file**

Write the following SQL to `supabase/migrations/003_seed_cadence_rules.sql`:

```sql
-- ============================================================
-- Migration 003: Default cadence rules
-- One row per SF stage name. Values from the product spec.
-- ============================================================
insert into cadence_rules
  (stage_name, days_between_touches, max_attempts, auto_followup_on_meeting, suggested_action, outreach_template_key)
values
  ('Scheduling First Call',      3, 5, false, 'Email with Edge value prop + collateral',                     'scheduling_first_call'),
  ('Revival',                    4, 4, false, 'Re-engagement email with new proof point',                    'revival'),
  ('First Call Scheduled',       2, 2, false, 'Confirmation + prep materials',                               'first_call_scheduled'),
  ('First Meeting Completed',    1, 3, true,  'Follow-up recap based on Gong summary + next step proposal',  'first_meeting_completed'),
  ('Second Call Scheduled',      2, 2, false, 'Agenda + relevant case study',                                'second_call_scheduled'),
  ('Second Meeting Completed',   1, 3, true,  'Follow-up recap + value-add content or proposal teaser',     'second_meeting_completed'),
  ('Proposal Meeting Scheduled', 2, 2, false, 'Pre-read materials',                                          'proposal_meeting_scheduled'),
  ('Proposal Sent',              2, 6, true,  'Check-in + handle objections',                               'proposal_sent'),
  ('Next Steps Scheduled',       2, 2, false, 'Confirmation',                                                'next_steps_scheduled'),
  ('Next Steps Completed',       2, 4, true,  'Push toward agreement',                                      'next_steps_completed'),
  ('Service Agreement Sent',     2, 6, false, 'Gentle follow-up, escalation path',                          'service_agreement_sent');
```

- [ ] **Step 2: Apply the migration**

Run via `mcp__supabase__apply_migration`:
- `name`: `"003_seed_cadence_rules"`
- `query`: the full SQL from Step 1

Expected: no error.

- [ ] **Step 3: Verify the rows**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT stage_name, days_between_touches, auto_followup_on_meeting
FROM cadence_rules
ORDER BY days_between_touches, stage_name;
```

Expected — 11 rows:
```
First Meeting Completed    | 1 | true
Second Meeting Completed   | 1 | true
First Call Scheduled       | 2 | false
Next Steps Completed       | 2 | true
Next Steps Scheduled       | 2 | false
Proposal Meeting Scheduled | 2 | false
Proposal Sent              | 2 | true
Second Call Scheduled      | 2 | false
Service Agreement Sent     | 2 | false
Scheduling First Call      | 3 | false
Revival                    | 4 | false
```

Confirm count:

```sql
SELECT count(*) FROM cadence_rules;
```

Expected: `11`

- [ ] **Step 4: Post-migration compliance audit**

After the migration succeeds, run the **Supabase compliance auditor** agent (`subagent_type: "supabase-compliance-auditor"`) to verify:

1. All 11 rows were inserted with correct values (spot-check `stage_name` and `days_between_touches`)
2. No orphaned or duplicate rows exist (`SELECT count(*) FROM cadence_rules` = 11)
3. The `outreach_template_key` values are unique and non-null (these will be referenced by the AI drafting engine later)

If the auditor finds discrepancies, fix them before committing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/003_seed_cadence_rules.sql
git commit -m "feat: seed default cadence rules for all 11 SF stages"
```

---

### Task 2: Collect rep emails before seeding rep_mapping

**The SF daily report (`report1776192631046.csv`) includes `Opportunity Owner` and `Opportunity Owner Email` columns, giving us real emails directly.** Collect a report from each rep (or have SF admin run a single all-rep report) to get the full email list rather than guessing.

- [ ] **Step 1: Extract emails from available SF reports**

Run the following Python snippet against any SF report CSV files you have (e.g. `report1776192631046.csv`). Each rep's report only contains their own opps, so you need at least one report per rep — or a single all-rep report if SF admin can generate one.

```bash
python3 -c "
import csv, glob, sys

owners = {}
for path in sys.argv[1:]:
    with open(path) as f:
        for row in csv.DictReader(f):
            name = row.get('Opportunity Owner', '').strip()
            email = row.get('Opportunity Owner Email', '').strip()
            if name and email:
                owners[name] = email

for name, email in sorted(owners.items()):
    print(f'{name!r}: {email!r}')
" /path/to/reports/*.csv
```

- [ ] **Step 2: For any reps with no SF report available, verify via Google Workspace**

Go to [Google Workspace Admin Console](https://admin.google.com) → Directory → Users → **Download user list** (CSV) to get remaining emails.

- [ ] **Step 3: Verify each email in the table below**

Cross-reference the 37 SF display names against the collected emails. Mark departed reps with `is_active = false`.

| SF Display Name | Guessed Email | Verified? | Notes |
|-----------------|--------------|-----------|-------|
| Alex Gold | alex.gold@keychain.com | | |
| Amy Wilcox | amy.wilcox@keychain.com | | |
| Ben Oliver | ben.oliver@keychain.com | | |
| Chad Ross | chad.ross@keychain.com | | |
| Chessney Goodman | chessney.goodman@keychain.com | | |
| Christian Montoya | christian.montoya@keychain.com | | |
| Deena Byrne | deena.byrne@keychain.com | | |
| Ellen Schryver | ellen.schryver@keychain.com | | |
| Grant Patton | grant.patton@keychain.com | | |
| Jacqueline Fallacara | jacqueline.fallacara@keychain.com | | |
| Jade Shelton | jade.shelton@keychain.com | | |
| Jenna Hackathorn | jenna.hackathorn@keychain.com | | |
| Jennifer Searles | jennifer.searles@keychain.com | | |
| Jonathan Kull | jonathan.kull@keychain.com | | |
| Jordan Weitz | jordan.weitz@keychain.com | | |
| Julia Ott | julia.ott@keychain.com | | |
| Kim Ryng | kim.ryng@keychain.com | | |
| Lyndsi Zapata | lyndsi.zapata@keychain.com | | |
| Max Lindemann | max.lindemann@keychain.com | | |
| Maxwell Fenn | maxwell.fenn@keychain.com | | |
| Maya Bakshi | maya.bakshi@keychain.com | | |
| Nick Newell | nick.newell@keychain.com | | |
| Partnerships | partnerships@keychain.com | N/A | Not a person. `is_active = false` |
| Pete Wolfinger | pete.wolfinger@keychain.com | | |
| Peter Self | peter.self@keychain.com | | |
| Randall Lopez | randall.lopez@keychain.com | | |
| Romy Lynch | romy.lynch@keychain.com | | |
| Shane O'Connell | shane.oconnell@keychain.com | | Apostrophe removed |
| Taylor Mangum | taylor.mangum@keychain.com | | |
| Taylor Patterson | taylor.patterson@keychain.com | | |
| Taylor Tempel | taylor.tempel@keychain.com | | |
| Teddy Callow | teddy.callow@keychain.com | | |
| Theo Staggers | theo.staggers@keychain.com | | |
| Tyler Madden | tyler.madden@keychain.com | | |
| Varun Pal | varun.pal@keychain.com | | |
| Wesley Phillips | wesley.phillips@keychain.com | | |
| Zachary Henault | zachary.henault@keychain.com | | |

- [ ] **Step 4: Update the migration SQL in Task 3 below with the actual emails before applying it**

---

### Task 3: Seed rep_mapping

- [ ] **Step 0: Pre-migration compliance audit**

Before applying the migration, run the **Supabase compliance auditor** agent (`subagent_type: "supabase-compliance-auditor"`) to validate the seed SQL against the live schema. The agent should:

1. Confirm the `rep_mapping` table exists and has the expected columns: `sf_display_name`, `rep_email`, `rep_name`, `is_active`
2. Confirm unique constraints on `sf_display_name` and `rep_email` (so duplicate inserts will fail cleanly)
3. Confirm column types match the INSERT values (text, text, text, boolean)
4. Confirm no RLS policies block service-role inserts
5. Flag any column name mismatches before the migration runs

If the auditor finds issues, fix the migration SQL before proceeding to Step 1.

- [ ] **Step 1: Create the migration file**

Write the following SQL to `supabase/migrations/004_seed_rep_mapping.sql`, replacing any emails that were corrected in Task 2:

```sql
-- ============================================================
-- Migration 004: Rep mapping (SF display name → @keychain.com)
-- Emails guessed as first.last@keychain.com — VERIFY before use.
-- 'Partnerships' is not a person; is_active = false.
-- ============================================================
insert into rep_mapping (sf_display_name, rep_email, rep_name, is_active)
values
  ('Alex Gold',           'alex.gold@keychain.com',           'Alex Gold',           true),
  ('Amy Wilcox',          'amy.wilcox@keychain.com',          'Amy Wilcox',          true),
  ('Ben Oliver',          'ben.oliver@keychain.com',          'Ben Oliver',          true),
  ('Chad Ross',           'chad.ross@keychain.com',           'Chad Ross',           true),
  ('Chessney Goodman',    'chessney.goodman@keychain.com',    'Chessney Goodman',    true),
  ('Christian Montoya',   'christian.montoya@keychain.com',   'Christian Montoya',   true),
  ('Deena Byrne',         'deena.byrne@keychain.com',         'Deena Byrne',         true),
  ('Ellen Schryver',      'ellen.schryver@keychain.com',      'Ellen Schryver',      true),
  ('Grant Patton',        'grant.patton@keychain.com',        'Grant Patton',        true),
  ('Jacqueline Fallacara','jacqueline.fallacara@keychain.com','Jacqueline Fallacara',true),
  ('Jade Shelton',        'jade.shelton@keychain.com',        'Jade Shelton',        true),
  ('Jenna Hackathorn',    'jenna.hackathorn@keychain.com',    'Jenna Hackathorn',    true),
  ('Jennifer Searles',    'jennifer.searles@keychain.com',    'Jennifer Searles',    true),
  ('Jonathan Kull',       'jonathan.kull@keychain.com',       'Jonathan Kull',       true),
  ('Jordan Weitz',        'jordan.weitz@keychain.com',        'Jordan Weitz',        true),
  ('Julia Ott',           'julia.ott@keychain.com',           'Julia Ott',           true),
  ('Kim Ryng',            'kim.ryng@keychain.com',            'Kim Ryng',            true),
  ('Lyndsi Zapata',       'lyndsi.zapata@keychain.com',       'Lyndsi Zapata',       true),
  ('Max Lindemann',       'max.lindemann@keychain.com',       'Max Lindemann',       true),
  ('Maxwell Fenn',        'maxwell.fenn@keychain.com',        'Maxwell Fenn',        true),
  ('Maya Bakshi',         'maya.bakshi@keychain.com',         'Maya Bakshi',         true),
  ('Nick Newell',         'nick.newell@keychain.com',         'Nick Newell',         true),
  ('Partnerships',        'partnerships@keychain.com',        'Partnerships',        false),
  ('Pete Wolfinger',      'pete.wolfinger@keychain.com',      'Pete Wolfinger',      true),
  ('Peter Self',          'peter.self@keychain.com',          'Peter Self',          true),
  ('Randall Lopez',       'randall.lopez@keychain.com',       'Randall Lopez',       true),
  ('Romy Lynch',          'romy.lynch@keychain.com',          'Romy Lynch',          true),
  ('Shane O''Connell',    'shane.oconnell@keychain.com',      'Shane O''Connell',    true),
  ('Taylor Mangum',       'taylor.mangum@keychain.com',       'Taylor Mangum',       true),
  ('Taylor Patterson',    'taylor.patterson@keychain.com',    'Taylor Patterson',    true),
  ('Taylor Tempel',       'taylor.tempel@keychain.com',       'Taylor Tempel',       true),
  ('Teddy Callow',        'teddy.callow@keychain.com',        'Teddy Callow',        true),
  ('Theo Staggers',       'theo.staggers@keychain.com',       'Theo Staggers',       true),
  ('Tyler Madden',        'tyler.madden@keychain.com',        'Tyler Madden',        true),
  ('Varun Pal',           'varun.pal@keychain.com',           'Varun Pal',           true),
  ('Wesley Phillips',     'wesley.phillips@keychain.com',     'Wesley Phillips',     true),
  ('Zachary Henault',     'zachary.henault@keychain.com',     'Zachary Henault',     true);
```

Note: `Shane O''Connell` uses doubled apostrophe — that is correct SQL escaping for a single quote inside a single-quoted string.

- [ ] **Step 2: Apply the migration**

Run via `mcp__supabase__apply_migration`:
- `name`: `"004_seed_rep_mapping"`
- `query`: the full SQL from Step 1

Expected: no error. If you get a unique constraint violation on `rep_email`, two rows have the same guessed email — fix the collision in the SQL and re-run.

- [ ] **Step 3: Verify count and spot-check**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT count(*) AS total,
       count(*) filter (where is_active = true)  AS active,
       count(*) filter (where is_active = false) AS inactive
FROM rep_mapping;
```

Expected: `total = 37`, `active = 36`, `inactive = 1` (Partnerships)

Spot-check a known rep:

```sql
SELECT sf_display_name, rep_email, is_active
FROM rep_mapping
WHERE sf_display_name = 'Alex Gold';
```

Expected: `Alex Gold | alex.gold@keychain.com | true`

- [ ] **Step 4: Check for any SF display names in the CSV that have no rep_mapping entry**

Run via `mcp__supabase__execute_sql` after the CSV import in Plan C. Until then, you can validate that the 37 names in this migration exactly match what's in the CSV by running this query against the uploaded CSV after Plan C's import:

```sql
SELECT o.opp_owner, count(*) as opp_count
FROM opportunities o
LEFT JOIN rep_mapping rm ON rm.sf_display_name = o.opp_owner
WHERE rm.id IS NULL
GROUP BY o.opp_owner
ORDER BY opp_count DESC;
```

Expected: 0 rows. Any rows returned mean those `opp_owner` values need a `rep_mapping` entry.

- [ ] **Step 5: Post-migration compliance audit**

After the migration succeeds, run the **Supabase compliance auditor** agent (`subagent_type: "supabase-compliance-auditor"`) to verify:

1. Row counts match expectations: `total = 37`, `active = 36`, `inactive = 1`
2. No duplicate `rep_email` values exist (would break downstream rep lookups)
3. The `sf_display_name` values are properly escaped (especially `Shane O'Connell`)
4. All active reps have non-null, properly formatted `@keychain.com` email addresses

If the auditor finds discrepancies, fix them before committing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/004_seed_rep_mapping.sql
git commit -m "feat: seed rep_mapping with 37 SF display names and guessed keychain.com emails"
```

---

### Plan B complete

`cadence_rules` and `rep_mapping` are seeded. Proceed to [Plan C: CSV Import Function](2026-04-14-day1-C-csv-import.md).
