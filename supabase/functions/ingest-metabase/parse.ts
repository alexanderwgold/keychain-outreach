import { parse as parseCSV } from "https://deno.land/std@0.208.0/csv/mod.ts";

export interface MetabaseChunk {
  sourceType: "metabase_report";
  sourceId: string;
  accountName: string;
  content: string;
  metadata: {
    manufacturer_name: string;
    projects_365d: number;
    projects_90d: number;
    verified_365d: number;
    verified_90d: number;
    views_90d: number;
    views_365d: number;
  };
}

function parseNum(raw: string): number {
  const n = parseInt(raw.replace(/,/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Parses a Metabase manufacturer activity CSV into embeddable text chunks.
 * Skips rows where all activity columns are zero (no useful data).
 * Falls back to manufacturer_name if salesforce_account_name is empty.
 */
export function parseMetabaseCSV(csvText: string, reportName: string): MetabaseChunk[] {
  const rawRows = parseCSV(csvText) as string[][];
  if (rawRows.length <= 1) return [];

  const headers = rawRows[0].map((h) => h.trim());
  const dataRows = rawRows.slice(1);
  const chunks: MetabaseChunk[] = [];

  for (const row of dataRows) {
    if (row.length < 2 || row.every((cell) => !cell.trim())) continue;

    const r: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      r[headers[i]] = (row[i] ?? "").trim();
    }

    const manufacturerName = r["manufacturer_name"] ?? "";
    const sfAccountName = r["salesforce_account_name"] ?? "";
    if (!manufacturerName && !sfAccountName) continue;

    const projects365 = parseNum(r["tagged_micro_cat_projects_last_365_days"] ?? "0");
    const projects90 = parseNum(r["tagged_micro_cat_projects_last_90_days"] ?? "0");
    const verified365 = parseNum(r["tagged_micro_cat_verified_projects_last_365_days"] ?? "0");
    const verified90 = parseNum(r["tagged_micro_cat_verified_projects_last_90_days"] ?? "0");
    const views90 = parseNum(r["tagged_micro_cat_views_last_90_days"] ?? "0");
    const views365 = parseNum(r["tagged_micro_cat_views_last_365_days"] ?? "0");

    // Skip rows with zero activity — no useful data for Claude
    const totalActivity = projects365 + projects90 + verified365 + verified90 + views90 + views365;
    if (totalActivity === 0) continue;

    const accountName = sfAccountName || manufacturerName;

    const content =
      `${manufacturerName} (SF: ${accountName}) — ` +
      `${projects90} projects (90d), ${projects365} projects (1yr). ` +
      `Verified: ${verified90} (90d), ${verified365} (1yr). ` +
      `Category views: ${views90} (90d), ${views365} (1yr).`;

    chunks.push({
      sourceType: "metabase_report",
      sourceId: reportName,
      accountName,
      content,
      metadata: {
        manufacturer_name: manufacturerName,
        projects_365d: projects365,
        projects_90d: projects90,
        verified_365d: verified365,
        verified_90d: verified90,
        views_90d: views90,
        views_365d: views365,
      },
    });
  }

  return chunks;
}
