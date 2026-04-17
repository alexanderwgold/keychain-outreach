import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { upsertKnowledge, type KnowledgeChunk } from "../_shared/knowledge.ts";
import { parseMetabaseCSV } from "./parse.ts";

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const forbid = await requireAdmin(req);
  if (forbid) return forbid;

  // Parse multipart form data
  let csvText: string;
  let reportName: string;
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return jsonResponse({ error: "No file provided in form field 'file'" }, 400);
    }
    csvText = await (file as File).text();
    reportName = (formData.get("report_name") as string) ?? (file as File).name ?? "metabase-report";
  } catch {
    return jsonResponse({ error: "Failed to parse multipart form data" }, 400);
  }

  try {
    const client = createAdminClient();

    // Parse CSV into text chunks
    const metabaseChunks = parseMetabaseCSV(csvText, reportName);

    if (metabaseChunks.length === 0) {
      return jsonResponse({
        rowsProcessed: 0,
        chunksUpserted: 0,
        errors: 0,
        arsenalSnapshot: null,
        message: "No active rows found in CSV",
      });
    }

    // Convert to KnowledgeChunk format
    const knowledgeChunks: KnowledgeChunk[] = metabaseChunks.map((mc) => ({
      sourceType: mc.sourceType,
      sourceId: mc.sourceId,
      accountName: mc.accountName,
      content: mc.content,
      metadata: mc.metadata,
    }));

    // Embed and upsert (batched)
    const result = await upsertKnowledge(client, knowledgeChunks);

    // Save raw CSV to arsenal Storage + upsert arsenal_items row of type=report.
    // Snapshot failure must NOT fail the overall ingest.
    let arsenalSnapshot: {
      path: string;
      status: "created" | "updated" | "skipped";
      itemId?: string;
      error?: string;
    } | null = null;

    try {
      const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const reportSlug = toSlug(reportName);
      const path = `global/metabase/${reportSlug}-${now}.csv`;

      const encoded = new TextEncoder().encode(csvText);
      const { error: uploadErr } = await client.storage
        .from("arsenal")
        .upload(path, encoded, { contentType: "text/csv", upsert: true });

      if (uploadErr) {
        arsenalSnapshot = { path, status: "skipped", error: `upload failed: ${uploadErr.message}` };
        console.error("arsenal snapshot upload failed:", uploadErr.message);
      } else {
        const { data: { publicUrl } } = client.storage.from("arsenal").getPublicUrl(path);

        // Check if a row exists for this storage_path
        const { data: existing } = await client
          .from("arsenal_items")
          .select("id")
          .eq("storage_path", path)
          .maybeSingle();

        const title = `${reportName} (${now})`;
        const description = `Metabase snapshot refreshed ${now}`;
        const tags = ["metabase", reportSlug];

        if (existing) {
          const { error: updateErr } = await client
            .from("arsenal_items")
            .update({ title, description, tags, url: publicUrl, active: true })
            .eq("id", existing.id);
          if (updateErr) {
            arsenalSnapshot = { path, status: "skipped", error: `update failed: ${updateErr.message}` };
            console.error("arsenal snapshot update failed:", updateErr.message);
          } else {
            arsenalSnapshot = { path, status: "updated", itemId: existing.id };
          }
        } else {
          const { data: inserted, error: insertErr } = await client
            .from("arsenal_items")
            .insert({
              visibility: "global",
              type: "report",
              title,
              description,
              url: publicUrl,
              storage_path: path,
              tags,
              created_by: "system@keychain.com",
            })
            .select("id")
            .single();
          if (insertErr) {
            arsenalSnapshot = { path, status: "skipped", error: `insert failed: ${insertErr.message}` };
            console.error("arsenal snapshot insert failed:", insertErr.message);
          } else {
            arsenalSnapshot = { path, status: "created", itemId: inserted.id };
          }
        }
      }
    } catch (snapErr) {
      console.error("arsenal snapshot error:", (snapErr as Error).message);
      arsenalSnapshot = {
        path: "",
        status: "skipped",
        error: (snapErr as Error).message,
      };
    }

    return jsonResponse({
      rowsProcessed: metabaseChunks.length,
      chunksUpserted: result.upserted,
      errors: result.errors,
      arsenalSnapshot,
    });
  } catch (e) {
    console.error("ingest-metabase error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
