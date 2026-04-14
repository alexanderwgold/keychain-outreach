# CSV Import & Salesforce Sync

There is no live Salesforce API in v1. Data enters two ways:
1. **Initial bulk import:** CSV file upload via the admin UI
2. **Ongoing sync:** Daily SF report email parsing (runs as part of the daily scan)

---

## CSV import (bulk)

### Trigger
Admin uploads a CSV via `/admin/upload` in the frontend. The frontend POSTs it to a `csv-import` Edge Function.

### CSV format
Based on the SF export in `/Users/alexgold-keychain/Documents/Claude/Projects/Keychain Outreach Tool/Contacts from SF & Opp Stages - Query result.csv`. Key columns:

| CSV column | Maps to |
|------------|---------|
| `id` | `contacts.sf_contact_id` |
| `first_name`, `last_name` | `contacts` |
| `email` | `contacts.email` |
| `title` | `contacts.title` |
| `opportunity_id` | `opportunities.sf_opportunity_id` |
| `account_id` | `opportunities.sf_account_id` |
| `account_name` | `opportunities.account_name` |
| `manufacturer_id` | `opportunities.manufacturer_id` |
| `opportunity_name` | `opportunities.opportunity_name` |
| `Opp Owner` | `opportunities.opp_owner` (also used to look up `rep_mapping.sf_display_name`) |
| `stage_name` | `opportunities.stage_name` |
| `close_date` | `opportunities.close_date` |
| `amount` | `opportunities.amount` |
| `next_step` | `opportunities.next_step` |
| `next_steps_c` | `opportunities.next_steps_c` |
| `description` | `opportunities.description` |

### Import logic
1. Parse CSV rows
2. For each row, upsert into `contacts` on `sf_contact_id`
3. Upsert into `opportunities` on `sf_opportunity_id`; resolve `rep_email` by looking up `opp_owner` in `rep_mapping`
4. Upsert into `opportunity_contacts` (opportunity_id, contact_id) — first contact per opportunity gets `primary = true`
5. Return summary: rows processed, opportunities upserted, contacts upserted, unmatched `opp_owner` values (display names with no `rep_mapping` entry) — these need to be manually added to `rep_mapping` before scans will work for those reps

### Re-upload behavior
Re-uploads are safe: all operations use upsert on SF IDs. Existing activity_log rows are not touched. Stage/field changes in the CSV overwrite the current DB values (the SF report email sync is the preferred update path going forward, but CSV re-upload is the fallback).

---

## SF report email sync (daily)

This runs as **Step 1 of the daily scan** for each rep. See `docs/edge-functions.md` for the full daily scan flow.

### SF report setup (one-time, requires SF admin)
- Create a scheduled report in Salesforce: open opportunities by owner, columns: Opportunity Name, Stage, Close Date, Amount, Next Step
- Schedule it to email each rep at **2:00pm ET daily** (so it arrives before the 3:30pm scan)
- The email will come from `reports@salesforce.com` with a consistent subject line

### Parsing logic
1. Search the rep's Gmail for an email from `reports@salesforce.com` received today
2. Identify it by sender + subject line (subject line format is determined during Day 2 testing)
3. Parse the HTML table body or CSV attachment — extract: Opportunity Name, Stage, Close Date, Amount, Next Step
4. For each row, find the matching `opportunities` row by `account_name` / `opportunity_name`
5. Diff each field against current DB values
6. On any change:
   - Update the `opportunities` row
   - Set `last_sf_sync_at = now()`
   - Insert an `activity_log` row: `source: sf_report`, `notes: "Stage changed from X to Y"` (or similar)
7. Stage changes trigger immediate recalculation of cadence — if a stage just changed, use the new stage's cadence rules for that rep's digest

### Open question
The exact HTML structure of the SF report email is unverified. Must test with a real email from Alex's inbox during Day 2 development before hardcoding the parser. Do not assume table column order.
