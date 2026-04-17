import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { getCallerEmail } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const callerEmail = await getCallerEmail(req);
  if (!callerEmail) return jsonResponse({ error: "unauthorized" }, 401);

  let body: { filename?: string; scope?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { filename, scope } = body;
  if (!filename || !["global", "private"].includes(scope ?? "")) {
    return jsonResponse({ error: "filename and scope required" }, 400);
  }

  const admin = createAdminClient();

  if (scope === "global") {
    const { data: mapping } = await admin
      .from("rep_mapping")
      .select("is_admin")
      .eq("rep_email", callerEmail)
      .maybeSingle();
    if (!mapping?.is_admin) return jsonResponse({ error: "admin_required" }, 403);
  }

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key =
    scope === "global"
      ? `global/${crypto.randomUUID()}-${safe}`
      : `private/${callerEmail}/${crypto.randomUUID()}-${safe}`;

  const { data, error } = await admin.storage.from("arsenal").createSignedUploadUrl(key);
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ uploadUrl: data.signedUrl, token: data.token, path: key });
});
