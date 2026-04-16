import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { googleApiFetch } from "../_shared/google-auth.ts";
import { parseCSVRows } from "../_shared/csv-parse.ts";

export interface SfUpdate {
  accountName: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface ScanSfEmailResult {
  sfUpdates: SfUpdate[];
  error?: string;
}

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

interface ExistingOpp {
  id: string;
  stage_name: string | null;
  amount: number | null;
  opp_owner: string | null;
  next_step: string | null;
  next_steps_c: string | null;
  account_name: string;
}

export async function scanSfEmail(
  repEmail: string,
  accessToken: string,
  client: SupabaseClient
): Promise<ScanSfEmailResult> {
  try {
    const searchQuery = "from:reports@salesforce.com newer_than:1d has:attachment";
    const searchResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}?q=${encodeURIComponent(searchQuery)}&maxResults=1`,
      accessToken
    );

    if (!searchResponse.ok) {
      return { sfUpdates: [], error: `Gmail search failed: ${searchResponse.status}` };
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages ?? [];

    if (messages.length === 0) {
      return { sfUpdates: [] };
    }

    const messageId = messages[0].id;

    const msgResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}/${messageId}`,
      accessToken
    );

    if (!msgResponse.ok) {
      return { sfUpdates: [], error: `Failed to fetch message: ${msgResponse.status}` };
    }

    const msgData = await msgResponse.json();

    const parts = msgData.payload?.parts ?? [];
    const csvPart = parts.find(
      (p: { filename: string; mimeType: string }) =>
        p.filename?.endsWith(".csv") || p.mimeType === "text/csv"
    );

    if (!csvPart?.body?.attachmentId) {
      return { sfUpdates: [], error: "No CSV attachment found in SF report email" };
    }

    const attResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}/${messageId}/attachments/${csvPart.body.attachmentId}`,
      accessToken
    );

    if (!attResponse.ok) {
      return { sfUpdates: [], error: `Failed to download attachment: ${attResponse.status}` };
    }

    const attData = await attResponse.json();
    const csvBase64 = attData.data.replace(/-/g, "+").replace(/_/g, "/");
    const csvText = atob(csvBase64);

    const rows = parseCSVRows(csvText);

    if (rows.length === 0) {
      return { sfUpdates: [] };
    }

    const DIFF_FIELDS = ["stage_name", "amount", "opp_owner", "next_step", "next_steps_c"];

    // ── Batch fetch: collect all referenced sf_opportunity_ids and load in one query ──
    const sfOppIds = Array.from(
      new Set(rows.map((r) => r.opportunity.sf_opportunity_id).filter(Boolean))
    );

    const { data: existingOpps, error: fetchError } = await client
      .from("opportunities")
      .select("id, stage_name, amount, opp_owner, next_step, next_steps_c, account_name, sf_opportunity_id")
      .in("sf_opportunity_id", sfOppIds);

    if (fetchError) {
      return { sfUpdates: [], error: `Failed to load opportunities: ${fetchError.message}` };
    }

    const existingBySfId = new Map<string, ExistingOpp & { sf_opportunity_id: string }>(
      (existingOpps ?? []).map((o: ExistingOpp & { sf_opportunity_id: string }) => [o.sf_opportunity_id, o])
    );

    const sfUpdates: SfUpdate[] = [];
    const oppUpdates: Array<{ id: string } & Record<string, unknown>> = [];
    const activityInserts: Array<Record<string, unknown>> = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      const existing = existingBySfId.get(row.opportunity.sf_opportunity_id);
      if (!existing) continue;

      const updates: Record<string, unknown> = {};

      for (const field of DIFF_FIELDS) {
        const oldVal = existing[field as keyof ExistingOpp];
        const newVal = row.opportunity[field as keyof typeof row.opportunity];
        if (newVal !== null && newVal !== undefined && String(newVal) !== String(oldVal ?? "")) {
          updates[field] = newVal;
          sfUpdates.push({
            accountName: existing.account_name,
            field,
            oldValue: oldVal != null ? String(oldVal) : null,
            newValue: String(newVal),
          });
        }
      }

      if (Object.keys(updates).length > 0) {
        oppUpdates.push({
          id: existing.id,
          ...updates,
          last_sf_sync_at: now,
        });

        activityInserts.push({
          opportunity_id: existing.id,
          rep_email: repEmail,
          activity_type: "manual_log",
          activity_date: now,
          subject: `SF update: ${Object.keys(updates).join(", ")}`,
          source: "sf_report",
        });
      }
    }

    // ── Batch writes ──
    if (oppUpdates.length > 0) {
      // Upsert on primary key `id`. Existing rows retain all non-specified columns.
      const { error: updateError } = await client
        .from("opportunities")
        .upsert(oppUpdates, { onConflict: "id" });
      if (updateError) {
        return { sfUpdates: [], error: `Opportunities update failed: ${updateError.message}` };
      }
    }

    if (activityInserts.length > 0) {
      const { error: insertError } = await client
        .from("activity_log")
        .insert(activityInserts);
      if (insertError) {
        return { sfUpdates, error: `activity_log insert failed: ${insertError.message}` };
      }
    }

    return { sfUpdates };
  } catch (e) {
    return { sfUpdates: [], error: (e as Error).message };
  }
}
