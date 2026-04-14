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
  // Parse without skipFirstRow to avoid strict field-count validation.
  // Salesforce exports can have extra trailing fields; we map by header name.
  const rawRows = parseCSV(csvText) as string[][];

  if (rawRows.length === 0) return [];

  const headers = rawRows[0].map((h) => h.trim());
  const dataRows = rawRows.slice(1);

  const seenOpportunities = new Set<string>();
  const result: ParsedRow[] = [];

  for (const row of dataRows) {
    // Build a record from the header columns.
    // Salesforce exports may include extra empty fields in a row, causing
    // more data fields than header columns. When this happens, map the
    // trailing header columns from the end of the row so that id,
    // opportunity_id, and account_id always align correctly.
    const r: Record<string, string> = {};
    const extra = row.length - headers.length;
    for (let i = 0; i < headers.length; i++) {
      // For columns beyond the extra-field boundary, read from the end
      const dataIdx = extra > 0 && i >= headers.length - 3 ? i + extra : i;
      r[headers[i]] = row[dataIdx] ?? "";
    }

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
 * Parses Salesforce close_date format: "Aug 31, 2025" -> "2025-08-31"
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
 * Parses amount string like "1,500.00" -> 1500 or "" -> null.
 */
function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}
