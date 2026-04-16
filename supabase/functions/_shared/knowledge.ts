import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Supabase.ai.Session is available globally in the Edge Runtime
// @ts-ignore — Supabase.ai is a runtime global, not in TS types
const model = new Supabase.ai.Session("gte-small");

export interface KnowledgeChunk {
  sourceType: "metabase_report" | "web_research" | "collateral";
  sourceId: string;
  accountName: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string; // ISO 8601 timestamp
}

export interface KnowledgeResult {
  id: string;
  source_type: string;
  source_id: string;
  account_name: string | null;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

/**
 * Generates a 384-dim embedding for the given text using the gte-small model.
 * Runs natively in the Supabase Edge Runtime — no external API call.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const output = await model.run(text, {
    mean_pool: true,
    normalize: true,
  });
  // output is a Float32Array or similar typed array
  return Array.from(output);
}

/**
 * Searches the knowledge_base for relevant chunks.
 * Uses the search_knowledge RPC function (created in migration 005).
 *
 * @param accountName - exact match filter (null for general search)
 * @param queryText - text to embed and search by similarity
 * @param limit - max results (default 10)
 */
export async function searchKnowledge(
  client: SupabaseClient,
  accountName: string | null,
  queryText: string,
  limit = 10
): Promise<KnowledgeResult[]> {
  const embedding = await generateEmbedding(queryText);

  const { data, error } = await client.rpc("search_knowledge", {
    query_embedding: JSON.stringify(embedding),
    match_account_name: accountName,
    match_threshold: 0.3,
    match_count: limit,
  });

  if (error) {
    console.error("Knowledge search failed:", error.message);
    return [];
  }

  return (data ?? []) as KnowledgeResult[];
}

/**
 * Upserts knowledge chunks into the knowledge_base table.
 * Generates embeddings for each chunk and inserts in batches.
 *
 * @param chunks - array of knowledge chunks to upsert
 * @param batchSize - rows per upsert batch (default 100, lower than csv-import's 500
 *   because embedding generation is the bottleneck)
 */
export async function upsertKnowledge(
  client: SupabaseClient,
  chunks: KnowledgeChunk[],
  batchSize = 100
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    const rows = await Promise.all(
      batch.map(async (chunk) => {
        const embedding = await generateEmbedding(chunk.content);
        return {
          source_type: chunk.sourceType,
          source_id: chunk.sourceId,
          account_name: chunk.accountName,
          content: chunk.content,
          embedding: JSON.stringify(embedding),
          metadata: chunk.metadata ?? {},
          expires_at: chunk.expiresAt ?? null,
        };
      })
    );

    const { error } = await client.from("knowledge_base").upsert(rows, {
      onConflict: "source_type,source_id,account_name",
    });

    if (error) {
      console.error(`Knowledge upsert batch ${i} failed:`, error.message);
      errors += batch.length;
    } else {
      upserted += batch.length;
    }
  }

  return { upserted, errors };
}

/**
 * Deletes expired knowledge rows (expires_at < now()).
 */
export async function purgeExpiredKnowledge(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from("knowledge_base")
    .delete({ count: "exact" })
    .lt("expires_at", new Date().toISOString());

  if (error) {
    console.error("Knowledge purge failed:", error.message);
    return 0;
  }
  return count ?? 0;
}
