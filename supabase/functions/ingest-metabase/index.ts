import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { upsertKnowledge, type KnowledgeChunk } from "../_shared/knowledge.ts";
import { parseMetabaseCSV } from "./parse.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Auth: require service_role JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.role !== "service_role") {
      return jsonResponse({ error: "Forbidden: service_role required" }, 403);
    }
  } catch {
    return jsonResponse({ error: "Invalid token" }, 401);
  }

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
      return jsonResponse({ rowsProcessed: 0, chunksUpserted: 0, errors: 0, message: "No active rows found in CSV" });
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

    return jsonResponse({
      rowsProcessed: metabaseChunks.length,
      chunksUpserted: result.upserted,
      errors: result.errors,
    });
  } catch (e) {
    console.error("ingest-metabase error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
