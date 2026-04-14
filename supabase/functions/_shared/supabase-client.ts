import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

/**
 * Returns a Supabase client using the service-role key.
 * This bypasses RLS and is safe to use only in Edge Functions
 * that are themselves protected (auth check in the handler).
 */
export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
