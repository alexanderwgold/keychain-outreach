import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import type { ParsedRow } from "../_shared/csv-parse.ts";

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
