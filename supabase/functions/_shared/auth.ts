import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { jsonResponse } from "./cors.ts";

/**
 * Extracts the caller's verified email from the Authorization Bearer JWT.
 * Returns null if the token is missing, invalid, or is the anon key
 * (which has no user/email claim).
 */
export async function getCallerEmail(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return null;
  return data.user.email.toLowerCase();
}

/**
 * Returns a 401/403 Response if the caller is missing or mismatched,
 * or null if the caller is authenticated as `targetRepEmail`.
 *
 * Use like: `const forbid = await requireSelf(req, repEmail); if (forbid) return forbid;`
 */
export async function requireSelf(
  req: Request,
  targetRepEmail: string,
): Promise<Response | null> {
  const callerEmail = await getCallerEmail(req);
  if (!callerEmail) {
    return jsonResponse({ error: "Unauthenticated" }, 401);
  }
  if (callerEmail !== targetRepEmail.trim().toLowerCase()) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  return null;
}

/**
 * Returns a 401/403 Response if the caller is not the service role,
 * or null if the request carries a service_role JWT.
 *
 * Use on endpoints called only by pg_cron or other server-to-server
 * trusted callers. Reads the `role` claim from the JWT payload
 * rather than calling Supabase Auth (which would need a user JWT).
 */
export function requireServiceRole(req: Request): Response | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthenticated" }, 401);
  }
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return jsonResponse({ error: "Invalid token" }, 401);
  }
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(parts[1].length + (4 - parts[1].length % 4) % 4, "=");
    const payload = JSON.parse(atob(padded));
    if (payload.role !== "service_role") {
      return jsonResponse({ error: "Forbidden: service role required" }, 403);
    }
    return null;
  } catch {
    return jsonResponse({ error: "Invalid token" }, 401);
  }
}

/**
 * Returns a 401/403 Response if the caller is not an authenticated admin,
 * or null if the caller is authenticated and `is_admin = true` in `rep_mapping`.
 *
 * Use like: `const forbid = await requireAdmin(req); if (forbid) return forbid;`
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const callerEmail = await getCallerEmail(req);
  if (!callerEmail) return jsonResponse({ error: "Unauthenticated" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await supabase
    .from("rep_mapping")
    .select("is_admin")
    .eq("rep_email", callerEmail)
    .maybeSingle();
  if (!data?.is_admin) return jsonResponse({ error: "Forbidden: admin only" }, 403);
  return null;
}
