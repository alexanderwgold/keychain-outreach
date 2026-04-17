import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { getCallerEmail } from "../_shared/auth.ts";
import { isBotUserAgent } from "../_shared/bot-filter.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  const repEmail = await getCallerEmail(req);
  if (!repEmail) return jsonResponse({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const ids = (url.searchParams.get("itemIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return jsonResponse({});
  }

  const admin = createAdminClient();

  const { data: links } = await admin
    .from("collateral_links")
    .select("id, slug, item_id, collateral_events(user_agent, created_at)")
    .in("item_id", ids)
    .eq("rep_email", repEmail)
    .eq("active", true);

  const result: Record<
    string,
    { openCount: number; lastOpenedAt: string | null; linkSlug: string | null }
  > = {};
  for (const id of ids) result[id] = { openCount: 0, lastOpenedAt: null, linkSlug: null };

  for (const link of links ?? []) {
    const entry = result[link.item_id];
    if (!entry) continue;
    entry.linkSlug = link.slug;
    const humanEvents = (link.collateral_events ?? []).filter(
      (e: { user_agent: string | null }) => !isBotUserAgent(e.user_agent),
    );
    entry.openCount += humanEvents.length;
    for (const e of humanEvents) {
      if (!entry.lastOpenedAt || e.created_at > entry.lastOpenedAt) {
        entry.lastOpenedAt = e.created_at;
      }
    }
  }

  return jsonResponse(result);
});
