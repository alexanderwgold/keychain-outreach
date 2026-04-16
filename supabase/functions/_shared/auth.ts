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
  if (callerEmail !== targetRepEmail.toLowerCase()) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  return null;
}
