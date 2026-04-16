import { createAdminClient } from "../_shared/supabase-client.ts";
import { upsertKnowledge, purgeExpiredKnowledge, type KnowledgeChunk } from "../_shared/knowledge.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-6";

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 2000;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const client = createAdminClient();
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const purged = await purgeExpiredKnowledge(client);
  console.log(`Purged ${purged} expired knowledge rows`);

  const { data: accounts, error: accError } = await client
    .from("opportunities")
    .select("account_name")
    .not("stage_name", "is", null)
    .not("account_name", "is", null);

  if (accError || !accounts?.length) {
    return new Response(
      JSON.stringify({ error: accError?.message ?? "No active accounts" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const uniqueAccounts = [...new Set(accounts.map((a: { account_name: string }) => a.account_name))];
  console.log(`Researching ${uniqueAccounts.length} active accounts`);

  let researched = 0;
  let errors = 0;

  for (let i = 0; i < uniqueAccounts.length; i += BATCH_SIZE) {
    const batch = uniqueAccounts.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (accountName) => {
        try {
          const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              max_tokens: 1024,
              tools: [{ type: "web_search", name: "web_search" }],
              messages: [{
                role: "user",
                content: `Search for recent news and developments about "${accountName}" in the manufacturing, sourcing, or supply chain space. Focus on the last 30 days. Provide a brief 1-2 paragraph summary of the most relevant findings. If no significant news is found, say "No recent news found."`,
              }],
            }),
          });

          if (!response.ok) {
            console.error(`Research failed for ${accountName}: ${response.status}`);
            return null;
          }

          const data = await response.json();
          const textBlocks = data.content?.filter(
            (b: { type: string }) => b.type === "text"
          ) ?? [];
          const researchText = textBlocks.map((b: { text: string }) => b.text).join("\n").trim();

          if (!researchText || researchText.includes("No recent news found")) {
            return null;
          }

          const today = new Date().toISOString().split("T")[0];
          const chunk: KnowledgeChunk = {
            sourceType: "web_research",
            sourceId: `research_batch_${today}`,
            accountName,
            content: researchText,
            metadata: { batch_date: today, query: accountName },
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          };

          return chunk;
        } catch (e) {
          console.error(`Research error for ${accountName}:`, (e as Error).message);
          return null;
        }
      })
    );

    const validChunks = results.filter((r): r is KnowledgeChunk => r !== null);
    if (validChunks.length > 0) {
      const result = await upsertKnowledge(client, validChunks);
      researched += result.upserted;
      errors += result.errors;
    }

    if (i + BATCH_SIZE < uniqueAccounts.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  const duration = Date.now() - startTime;
  console.log(`Research batch complete: ${researched} accounts researched, ${errors} errors, ${duration}ms`);

  return new Response(
    JSON.stringify({
      totalAccounts: uniqueAccounts.length,
      researched,
      errors,
      purgedExpired: purged,
      durationMs: duration,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
