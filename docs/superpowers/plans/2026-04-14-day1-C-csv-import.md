# Day 1-C: CSV Import Edge Function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a `csv-import` Supabase Edge Function that accepts a multipart CSV upload and upserts all contacts, opportunities, and join rows into the database. Then run a full import of the ~8,003-row Salesforce export.

**Architecture:** One Edge Function with three modules: `parse.ts` (pure CSV → typed rows), `upsert.ts` (batch DB writes), and `index.ts` (HTTP handler). Shared admin client lives in `_shared/supabase-client.ts`. Parse logic is fully unit-tested with `deno test`. Upsert is validated via integration test against the live Supabase project.

**Tech Stack:** Deno 1.40+, Supabase JS SDK v2, `deno.land/std@0.208.0` CSV parser, Supabase MCP (`mcp__supabase__deploy_edge_function`)

**Prerequisites:** Plan A (schema) and Plan B (rep_mapping seeded) must be complete.

---

## Files

| Action | Path |
|--------|------|
| Create | `supabase/functions/_shared/supabase-client.ts` |
| Create | `supabase/functions/csv-import/parse.ts` |
| Create | `supabase/functions/csv-import/parse.test.ts` |
| Create | `supabase/functions/csv-import/upsert.ts` |
| Create | `supabase/functions/csv-import/index.ts` |

---

### Task 1: Create the shared admin client

- [ ] **Step 1: Write the shared client factory**

Create `supabase/functions/_shared/supabase-client.ts`:

```typescript
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

/**
 * Returns a Supabase client using the service-role key.
 * This bypasses RLS and is safe to use only in Edge Functions
 * that are themselves protected (auth check in the handler).
 */
export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/supabase-client.ts
git commit -m "feat: add shared admin Supabase client factory"
```

---

### Task 2: Write the failing parse tests

- [ ] **Step 1: Write `parse.test.ts`**

Create `supabase/functions/csv-import/parse.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseCSVRows } from "./parse.ts";

// The exact header row from the Salesforce export.
const HEADER =
  "Account Name,manufacturer_id,first_name,last_name,email,title," +
  "opportunity_name,Opp Owner,stage_name,close_date,amount,next_step," +
  "next_steps_c,description,id,opportunity_id,account_id";

Deno.test("parseCSVRows: extracts contact fields correctly", () => {
  const csv =
    HEADER +
    '\nAcme Co,"54,682",John,Doe,john@acme.com,VP Sourcing,' +
    'Acme Opp,Wesley Phillips,Revival,"Aug 31, 2025",,,,,' +
    '"003ABC","006ABC","001ABC"';

  const rows = parseCSVRows(csv);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].contact.sf_contact_id, "003ABC");
  assertEquals(rows[0].contact.first_name, "John");
  assertEquals(rows[0].contact.last_name, "Doe");
  assertEquals(rows[0].contact.email, "john@acme.com");
  assertEquals(rows[0].contact.title, "VP Sourcing");
});

Deno.test("parseCSVRows: extracts opportunity fields correctly", () => {
  const csv =
    HEADER +
    '\nAcme Co,"54,682",John,Doe,john@acme.com,VP Sourcing,' +
    'Acme Opp,Wesley Phillips,Revival,"Aug 31, 2025","1,500",,,,,' +
    '"003ABC","006ABC","001ABC"';

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.account_name, "Acme Co");
  assertEquals(rows[0].opportunity.sf_opportunity_id, "006ABC");
  assertEquals(rows[0].opportunity.sf_account_id, "001ABC");
  assertEquals(rows[0].opportunity.manufacturer_id, "54,682");
  assertEquals(rows[0].opportunity.opp_owner, "Wesley Phillips");
  assertEquals(rows[0].opportunity.stage_name, "Revival");
  assertEquals(rows[0].opportunity.close_date, "2025-08-31");
  assertEquals(rows[0].opportunity.amount, 1500);
});

Deno.test("parseCSVRows: null email and title when blank", () => {
  const csv =
    HEADER +
    "\nAcme Co,,John,Doe,,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].contact.email, null);
  assertEquals(rows[0].contact.title, null);
});

Deno.test("parseCSVRows: null close_date when blank", () => {
  const csv =
    HEADER +
    "\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.close_date, null);
});

Deno.test("parseCSVRows: null amount when blank", () => {
  const csv =
    HEADER +
    "\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.amount, null);
});

Deno.test("parseCSVRows: parses close_date 'Aug 31, 2025' → '2025-08-31'", () => {
  const csv =
    HEADER +
    '\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,"Aug 31, 2025",,,,,' +
    "003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.close_date, "2025-08-31");
});

Deno.test("parseCSVRows: parses amount '1,500' → 1500", () => {
  const csv =
    HEADER +
    '\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,"1,500",,,,003ABC,006ABC,001ABC';

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.amount, 1500);
});

Deno.test("parseCSVRows: marks first contact per opportunity as primary", () => {
  const csv = [
    HEADER,
    "Acme Co,,John,Doe,john@acme.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003AAA,006ABC,001ABC",
    "Acme Co,,Jane,Smith,jane@acme.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003BBB,006ABC,001ABC",
  ].join("\n");

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].isPrimaryContact, true);
  assertEquals(rows[1].isPrimaryContact, false);
});

Deno.test("parseCSVRows: same contact on two opps is primary for each", () => {
  const csv = [
    HEADER,
    "Acme Co,,John,Doe,john@acme.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003AAA,006AAA,001ABC",
    "Beta Corp,,John,Doe,john@acme.com,,Beta Opp,Wesley Phillips,Revival,,,,,,003AAA,006BBB,001XYZ",
  ].join("\n");

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].isPrimaryContact, true); // primary for 006AAA
  assertEquals(rows[1].isPrimaryContact, true); // primary for 006BBB
});

Deno.test("parseCSVRows: manufacturer_id with comma is preserved as string", () => {
  const csv =
    HEADER +
    '\nAcme Co,"54,682",John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC';

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.manufacturer_id, "54,682");
});

Deno.test("parseCSVRows: skips empty trailing lines", () => {
  const csv = HEADER + "\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC\n\n";
  const rows = parseCSVRows(csv);
  assertEquals(rows.length, 1);
});
```

- [ ] **Step 2: Run the tests — expect failure**

```bash
deno test --allow-all supabase/functions/csv-import/parse.test.ts
```

Expected output: error like `Cannot find module './parse.ts'` or similar. This confirms the tests are wired correctly and the implementation doesn't exist yet.

---

### Task 3: Implement parse.ts

- [ ] **Step 1: Write `parse.ts`**

Create `supabase/functions/csv-import/parse.ts`:

```typescript
import { parse as parseCSV } from "https://deno.land/std@0.208.0/csv/mod.ts";

export interface ContactRow {
  sf_contact_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
}

export interface OpportunityRow {
  sf_opportunity_id: string;
  sf_account_id: string | null;
  account_name: string;
  manufacturer_id: string | null;
  opportunity_name: string;
  opp_owner: string;
  stage_name: string | null;
  close_date: string | null; // ISO date "YYYY-MM-DD" or null
  amount: number | null;
  next_step: string | null;
  next_steps_c: string | null;
  description: string | null;
}

export interface ParsedRow {
  contact: ContactRow;
  opportunity: OpportunityRow;
  isPrimaryContact: boolean;
}

/**
 * Parses the Salesforce CSV export text into typed rows.
 * Handles quoted fields (commas in manufacturer_id, close_date, amount).
 * Sets isPrimaryContact = true for the first row seen per sf_opportunity_id.
 */
export function parseCSVRows(csvText: string): ParsedRow[] {
  const records = parseCSV(csvText, {
    skipFirstRow: true,
    strip: true,
  }) as Record<string, string>[];

  const seenOpportunities = new Set<string>();
  const result: ParsedRow[] = [];

  for (const r of records) {
    // Skip completely empty rows (trailing newlines in CSV)
    if (!r["id"] && !r["opportunity_id"]) continue;

    const sfOppId = (r["opportunity_id"] ?? "").trim();
    const isPrimaryContact = !seenOpportunities.has(sfOppId);
    seenOpportunities.add(sfOppId);

    result.push({
      contact: {
        sf_contact_id: (r["id"] ?? "").trim(),
        first_name: (r["first_name"] ?? "").trim(),
        last_name: (r["last_name"] ?? "").trim(),
        email: (r["email"] ?? "").trim() || null,
        title: (r["title"] ?? "").trim() || null,
      },
      opportunity: {
        sf_opportunity_id: sfOppId,
        sf_account_id: (r["account_id"] ?? "").trim() || null,
        account_name: (r["Account Name"] ?? "").trim(),
        manufacturer_id: (r["manufacturer_id"] ?? "").trim() || null,
        opportunity_name: (r["opportunity_name"] ?? "").trim(),
        opp_owner: (r["Opp Owner"] ?? "").trim(),
        stage_name: (r["stage_name"] ?? "").trim() || null,
        close_date: parseCloseDate((r["close_date"] ?? "").trim()),
        amount: parseAmount((r["amount"] ?? "").trim()),
        next_step: (r["next_step"] ?? "").trim() || null,
        next_steps_c: (r["next_steps_c"] ?? "").trim() || null,
        description: (r["description"] ?? "").trim() || null,
      },
      isPrimaryContact,
    });
  }

  return result;
}

/**
 * Parses Salesforce close_date format: "Aug 31, 2025" → "2025-08-31"
 * Returns null if blank or unrecognized format.
 */
function parseCloseDate(raw: string): string | null {
  if (!raw) return null;
  const MONTHS: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const match = raw.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;
  const [, mon, day, year] = match;
  const month = MONTHS[mon];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

/**
 * Parses amount string like "1,500.00" → 1500 or "" → null.
 */
function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}
```

- [ ] **Step 2: Run the tests — expect all to pass**

```bash
deno test --allow-all supabase/functions/csv-import/parse.test.ts
```

Expected output:
```
running 11 tests from ./supabase/functions/csv-import/parse.test.ts
parseCSVRows: extracts contact fields correctly ... ok (Xms)
parseCSVRows: extracts opportunity fields correctly ... ok (Xms)
parseCSVRows: null email and title when blank ... ok (Xms)
parseCSVRows: null close_date when blank ... ok (Xms)
parseCSVRows: null amount when blank ... ok (Xms)
parseCSVRows: parses close_date 'Aug 31, 2025' → '2025-08-31' ... ok (Xms)
parseCSVRows: parses amount '1,500' → 1500 ... ok (Xms)
parseCSVRows: marks first contact per opportunity as primary ... ok (Xms)
parseCSVRows: same contact on two opps is primary for each ... ok (Xms)
parseCSVRows: manufacturer_id with comma is preserved as string ... ok (Xms)
parseCSVRows: skips empty trailing lines ... ok (Xms)

ok | 11 passed | 0 failed (Xs)
```

If any test fails, fix `parse.ts` (not the tests) and re-run until all pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/csv-import/parse.ts supabase/functions/csv-import/parse.test.ts
git commit -m "feat: implement CSV parse module with full unit test coverage"
```

---

### Task 4: Implement upsert.ts

- [ ] **Step 1: Write `upsert.ts`**

Create `supabase/functions/csv-import/upsert.ts`:

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import type { ParsedRow } from "./parse.ts";

export interface ImportSummary {
  rowsProcessed: number;
  opportunitiesUpserted: number;
  contactsUpserted: number;
  unmatchedOwners: string[];
}

// Supabase PostgREST has a default max of ~500 rows per request.
const CHUNK_SIZE = 500;

/**
 * Upserts all contacts, opportunities, and opportunity_contacts from parsed CSV rows.
 * Resolves opp_owner → rep_email via the rep_mapping table.
 * Returns a summary including any opp_owner values with no rep_mapping entry.
 */
export async function upsertData(
  rows: ParsedRow[],
  client: SupabaseClient
): Promise<ImportSummary> {
  // ── Step 1: Load rep_mapping to resolve opp_owner → rep_email ──
  const { data: repMappings, error: rmError } = await client
    .from("rep_mapping")
    .select("sf_display_name, rep_email");
  if (rmError) throw new Error(`Failed to load rep_mapping: ${rmError.message}`);

  const repMap = new Map<string, string>(
    (repMappings ?? []).map((r: { sf_display_name: string; rep_email: string }) => [
      r.sf_display_name,
      r.rep_email,
    ])
  );
  const unmatchedOwners = new Set<string>();

  // ── Step 2: Upsert contacts (deduplicated by sf_contact_id) ──
  const uniqueContacts = new Map<string, ParsedRow["contact"]>();
  for (const row of rows) {
    uniqueContacts.set(row.contact.sf_contact_id, row.contact);
  }

  const contactResults: { id: string; sf_contact_id: string }[] = [];
  for (const chunk of chunkArray(Array.from(uniqueContacts.values()), CHUNK_SIZE)) {
    const { data, error } = await client
      .from("contacts")
      .upsert(chunk, { onConflict: "sf_contact_id" })
      .select("id, sf_contact_id");
    if (error) throw new Error(`Contacts upsert failed: ${error.message}`);
    contactResults.push(...(data ?? []));
  }

  const contactIdMap = new Map<string, string>(
    contactResults.map((c) => [c.sf_contact_id, c.id])
  );

  // ── Step 3: Upsert opportunities (deduplicated by sf_opportunity_id) ──
  const uniqueOpps = new Map<
    string,
    ParsedRow["opportunity"] & { rep_email: string | null }
  >();
  for (const row of rows) {
    if (!uniqueOpps.has(row.opportunity.sf_opportunity_id)) {
      const rep_email = repMap.get(row.opportunity.opp_owner) ?? null;
      if (!rep_email) unmatchedOwners.add(row.opportunity.opp_owner);
      uniqueOpps.set(row.opportunity.sf_opportunity_id, {
        ...row.opportunity,
        rep_email,
      });
    }
  }

  const oppResults: { id: string; sf_opportunity_id: string }[] = [];
  for (const chunk of chunkArray(Array.from(uniqueOpps.values()), CHUNK_SIZE)) {
    const { data, error } = await client
      .from("opportunities")
      .upsert(chunk, { onConflict: "sf_opportunity_id" })
      .select("id, sf_opportunity_id");
    if (error) throw new Error(`Opportunities upsert failed: ${error.message}`);
    oppResults.push(...(data ?? []));
  }

  const oppIdMap = new Map<string, string>(
    oppResults.map((o) => [o.sf_opportunity_id, o.id])
  );

  // ── Step 4: Upsert opportunity_contacts join rows ──
  const ocRows = rows
    .map((row) => ({
      opportunity_id: oppIdMap.get(row.opportunity.sf_opportunity_id)!,
      contact_id: contactIdMap.get(row.contact.sf_contact_id)!,
      primary: row.isPrimaryContact,
    }))
    .filter((r) => r.opportunity_id && r.contact_id);

  for (const chunk of chunkArray(ocRows, CHUNK_SIZE)) {
    const { error } = await client
      .from("opportunity_contacts")
      .upsert(chunk, { onConflict: "opportunity_id,contact_id" });
    if (error) throw new Error(`opportunity_contacts upsert failed: ${error.message}`);
  }

  return {
    rowsProcessed: rows.length,
    opportunitiesUpserted: uniqueOpps.size,
    contactsUpserted: uniqueContacts.size,
    unmatchedOwners: Array.from(unmatchedOwners),
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/csv-import/upsert.ts
git commit -m "feat: implement batch upsert for contacts, opportunities, and joins"
```

---

### Task 5: Write the HTTP handler

- [ ] **Step 1: Write `index.ts`**

Create `supabase/functions/csv-import/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { parseCSVRows } from "./parse.ts";
import { upsertData } from "./upsert.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Only allow calls from the service-role key (admin-only operation).
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let csvText: string;
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return json({ error: "No file provided in form field 'file'" }, 400);
    }
    csvText = await (file as File).text();
  } catch {
    return json({ error: "Failed to parse multipart form data" }, 400);
  }

  try {
    const client = createAdminClient();
    const rows = parseCSVRows(csvText);
    const summary = await upsertData(rows, client);
    return json(summary, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/csv-import/index.ts
git commit -m "feat: add csv-import Edge Function HTTP handler"
```

---

### Task 6: Pre-deployment compliance audit & deploy

- [ ] **Step 0: Pre-deployment compliance audit**

Before deploying, run the **Supabase compliance auditor** agent (`subagent_type: "supabase-compliance-auditor"`) to validate the Edge Function code against the live schema. The agent should review `upsert.ts` and `parse.ts` and verify:

1. **Column names in upsert.ts**: all `.from("table").upsert(...)` and `.select(...)` calls reference columns that actually exist in the live schema
   - `contacts`: `sf_contact_id`, `first_name`, `last_name`, `email`, `title`
   - `opportunities`: `sf_opportunity_id`, `sf_account_id`, `account_name`, `manufacturer_id`, `opportunity_name`, `opp_owner`, `rep_email`, `stage_name`, `close_date`, `amount`, `next_step`, `next_steps_c`, `description`
   - `opportunity_contacts`: `opportunity_id`, `contact_id`, `"primary"`
   - `rep_mapping`: `sf_display_name`, `rep_email`
2. **Conflict columns**: `onConflict: "sf_contact_id"`, `onConflict: "sf_opportunity_id"`, and `onConflict: "opportunity_id,contact_id"` match actual unique constraints
3. **RLS compliance**: service-role key bypasses RLS, but confirm no policies would interfere if the key were misconfigured
4. **Data types**: parsed values (dates as ISO strings, amounts as numbers) match column types (`date`, `numeric`)

If the auditor finds column name mismatches or constraint issues, fix the code before deploying.

- [ ] **Step 1: Deploy via MCP**

Run `mcp__supabase__deploy_edge_function` with:
- `name`: `"csv-import"`
- `files`: all four function files:
  - `supabase/functions/_shared/supabase-client.ts`
  - `supabase/functions/csv-import/index.ts`
  - `supabase/functions/csv-import/parse.ts`
  - `supabase/functions/csv-import/upsert.ts`

(Do not include `parse.test.ts` — test files are not deployed.)

Expected: deployment succeeds with no error.

- [ ] **Step 2: Confirm the function is deployed**

Run `mcp__supabase__list_edge_functions`.

Expected: `csv-import` appears in the list with a recent `created_at` timestamp.

---

### Task 7: Integration test with a small sample

- [ ] **Step 1: Create a sample CSV with 3 rows**

Save the following to `/tmp/sample_import.csv` (this uses real column names from the SF export):

```csv
Account Name,manufacturer_id,first_name,last_name,email,title,opportunity_name,Opp Owner,stage_name,close_date,amount,next_step,next_steps_c,description,id,opportunity_id,account_id
1008 Grinstead Mill Road Dairy,"54,682",Aaron,Jonas,aaronj@msfdairy.com,,1008 Grinstead Mill Road Dairy,Wesley Phillips,Revival,"Aug 31, 2025",,,,,003V500000QVxXuIAL,006V500000CNPjaIAH,001V500000A5AGjIAN
1008 Grinstead Mill Road Dairy,"54,682",Joel,Laufer,jlaufer@millroaddairy.com,,1008 Grinstead Mill Road Dairy,Wesley Phillips,Revival,"Aug 31, 2025",,,,,003V500000K9CBNIA3,006V500000CNPjaIAH,001V500000A5AGjIAN
```

- [ ] **Step 2: Call the deployed function**

```bash
curl -s -X POST \
  "https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/csv-import" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -F "file=@/tmp/sample_import.csv"
```

Expected JSON response:
```json
{
  "rowsProcessed": 2,
  "opportunitiesUpserted": 1,
  "contactsUpserted": 2,
  "unmatchedOwners": []
}
```

If `unmatchedOwners` contains `"Wesley Phillips"`, the rep_mapping seed from Plan B has the wrong email or wasn't applied. Fix and re-seed before the full import.

If you get a 500, check logs:

```
mcp__supabase__get_logs with function: "csv-import"
```

- [ ] **Step 3: Verify rows in DB**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT o.account_name, o.stage_name, o.rep_email,
       c.first_name, c.last_name, c.email,
       oc."primary"
FROM opportunities o
JOIN opportunity_contacts oc ON oc.opportunity_id = o.id
JOIN contacts c ON c.id = oc.contact_id
ORDER BY c.last_name;
```

Expected — 2 rows:
```
1008 Grinstead Mill Road Dairy | Revival | wesley.phillips@keychain.com | Aaron | Jonas | aaronj@msfdairy.com | true
1008 Grinstead Mill Road Dairy | Revival | wesley.phillips@keychain.com | Joel  | Laufer | jlaufer@millroaddairy.com | false
```

- [ ] **Step 4: Post-integration-test compliance audit**

After the sample import succeeds, run the **Supabase compliance auditor** agent (`subagent_type: "supabase-compliance-auditor"`) to verify the data landed correctly:

1. The 2 sample rows in `contacts` have correct `sf_contact_id`, `first_name`, `last_name`, `email` values
2. The 1 sample row in `opportunities` has correct `sf_opportunity_id`, `rep_email` (resolved via `rep_mapping`), `stage_name`, `close_date` format
3. The 2 rows in `opportunity_contacts` have correct `opportunity_id`/`contact_id` foreign keys and `"primary"` flags (first=true, second=false)
4. No orphaned rows exist in any table

If the auditor finds data integrity issues, diagnose whether the problem is in `parse.ts` or `upsert.ts` and fix before proceeding to the full import.

- [ ] **Step 5: Commit verification note**

```bash
git commit --allow-empty -m "chore: csv-import integration test passed with sample data"
```

---

### Task 8: Import the full Salesforce CSV

**Before running this step:** confirm Plan B (rep_mapping) is fully verified — any unmatched owner will leave `rep_email = null` on their opportunities, breaking their daily scan.

- [ ] **Step 1: Clear the sample data**

Run via `mcp__supabase__execute_sql`:

```sql
TRUNCATE opportunity_contacts, activity_log, upcoming_meetings, opportunities, contacts RESTART IDENTITY CASCADE;
```

- [ ] **Step 2: Import the full CSV**

```bash
curl -s -X POST \
  "https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/csv-import" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -F "file=@\"/Users/alexgold-keychain/Documents/Claude/Projects/Keychain Outreach Tool/Contacts from SF & Opp Stages - Query result.csv\""
```

Expected JSON response (approximate numbers):
```json
{
  "rowsProcessed": 8003,
  "opportunitiesUpserted": 4290,
  "contactsUpserted": 7987,
  "unmatchedOwners": []
}
```

If `unmatchedOwners` is non-empty, those SF display names need to be added to `rep_mapping` and the import re-run (the upsert is idempotent — it's safe to re-run).

- [ ] **Step 3: Verify final DB counts**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT
  (SELECT count(*) FROM opportunities)        AS opportunities,
  (SELECT count(*) FROM contacts)             AS contacts,
  (SELECT count(*) FROM opportunity_contacts) AS links,
  (SELECT count(*) FROM opportunities WHERE rep_email IS NULL) AS unlinked_opps;
```

Expected: `opportunities ≈ 4290`, `contacts ≈ 8003`, `links ≈ 8003`, `unlinked_opps = 0`

If `unlinked_opps > 0`, run the unmatched query from Plan B Task 3 Step 4, add missing reps to `rep_mapping`, and re-run the full import.

---

### Task 9: Post-import compliance audit

- [ ] **Step 1: Run the compliance auditor on the full dataset**

After the full import succeeds, run the **Supabase compliance auditor** agent (`subagent_type: "supabase-compliance-auditor"`) to perform a comprehensive data integrity check:

1. **Row counts**: `opportunities ≈ 4,290`, `contacts ≈ 8,003`, `opportunity_contacts ≈ 8,003`
2. **No null rep_email**: `SELECT count(*) FROM opportunities WHERE rep_email IS NULL` = 0 (all opp_owners resolved via rep_mapping)
3. **No orphaned joins**: every `opportunity_contacts.opportunity_id` has a matching `opportunities.id`, every `contact_id` has a matching `contacts.id`
4. **No duplicate SF IDs**: `SELECT sf_opportunity_id, count(*) FROM opportunities GROUP BY 1 HAVING count(*) > 1` returns 0 rows; same for `sf_contact_id` in contacts
5. **Foreign key integrity**: no violations across `opportunity_contacts → opportunities` and `opportunity_contacts → contacts`
6. **RLS check**: confirm RLS is still enabled on all tables and no policies were inadvertently created or modified during the import

If the auditor finds any issues, document them and determine whether a re-import or targeted fix is needed.

---

### Plan C complete

The `csv-import` function is deployed and the full Salesforce dataset is in the database. Proceed to [Plan D: Google OAuth Setup](2026-04-14-day1-D-google-oauth.md) if not already done.
