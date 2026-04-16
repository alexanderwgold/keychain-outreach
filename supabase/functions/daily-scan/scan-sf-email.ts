import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { googleApiFetch } from "../_shared/google-auth.ts";

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

    const { parseCSVRows } = await import("../../csv-import/parse.ts");
    const rows = parseCSVRows(csvText);

    const sfUpdates: SfUpdate[] = [];
    const DIFF_FIELDS = ["stage_name", "amount", "opp_owner", "next_step", "next_steps_c"];

    for (const row of rows) {
      const { data: existing } = await client
        .from("opportunities")
        .select("id, stage_name, amount, opp_owner, next_step, next_steps_c, account_name")
        .eq("sf_opportunity_id", row.opportunity.sf_opportunity_id)
        .single();

      if (!existing) continue;

      const updates: Record<string, unknown> = {};

      for (const field of DIFF_FIELDS) {
        const oldVal = existing[field as keyof typeof existing];
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
        updates["last_sf_sync_at"] = new Date().toISOString();
        await client
          .from("opportunities")
          .update(updates)
          .eq("id", existing.id);

        await client.from("activity_log").insert({
          opportunity_id: existing.id,
          rep_email: repEmail,
          activity_type: "manual_log",
          activity_date: new Date().toISOString(),
          subject: `SF update: ${Object.keys(updates).filter((k) => k !== "last_sf_sync_at").join(", ")}`,
          source: "sf_report",
        });
      }
    }

    return { sfUpdates };
  } catch (e) {
    return { sfUpdates: [], error: (e as Error).message };
  }
}
