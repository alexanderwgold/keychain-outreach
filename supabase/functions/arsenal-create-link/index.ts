import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { getCallerEmail } from "../_shared/auth.ts";

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function makeSlug(length = 8): string {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += BASE62[b % BASE62.length];
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const repEmail = await getCallerEmail(req);
  if (!repEmail) return jsonResponse({ error: "unauthorized" }, 401);

  let body: { itemId?: string; prospectEmail?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { itemId, prospectEmail } = body;
  if (!itemId) return jsonResponse({ error: "itemId required" }, 400);

  const admin = createAdminClient();

  // Enforce read access on the item
  const { data: item } = await admin
    .from("arsenal_items")
    .select("id, visibility, owner_email, active")
    .eq("id", itemId)
    .maybeSingle();

  if (!item || !item.active) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  const canRead =
    item.visibility === "global" ||
    (item.visibility === "private" && item.owner_email === repEmail);
  if (!canRead) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  // Reuse existing active link if one matches
  const { data: existing } = await admin
    .from("collateral_links")
    .select("slug")
    .eq("item_id", itemId)
    .eq("rep_email", repEmail)
    .filter("prospect_email", prospectEmail ? "eq" : "is", prospectEmail ?? null)
    .eq("active", true)
    .maybeSingle();

  if (existing) {
    return jsonResponse({ slug: existing.slug });
  }

  // Generate a unique slug (retry on unique violation up to 3 times)
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = makeSlug();
    const { error } = await admin.from("collateral_links").insert({
      slug,
      item_id: itemId,
      rep_email: repEmail,
      prospect_email: prospectEmail ?? null,
    });
    if (!error) return jsonResponse({ slug });
    if (error.code !== "23505") {
      // not a unique-violation — bail immediately
      lastErr = error;
      break;
    }
    lastErr = error;
  }

  return jsonResponse({ error: "slug_collision", detail: String(lastErr) }, 500);
});
