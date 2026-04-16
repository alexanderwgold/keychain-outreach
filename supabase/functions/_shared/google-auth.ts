import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Retrieves a fresh Google access token for a rep by:
 * 1. Loading the Vault secret UUID from rep_tokens
 * 2. Decrypting the refresh token via vault.decrypted_secrets
 * 3. Exchanging it for a short-lived access token
 *
 * @throws if rep has no token, vault decryption fails, or Google rejects the refresh
 */
export async function refreshGoogleToken(
  repEmail: string,
  client: SupabaseClient
): Promise<string> {
  // Step 1: Get the Vault secret UUID from rep_tokens
  const { data: repToken, error: repError } = await client
    .from("rep_tokens")
    .select("google_refresh_token")
    .eq("rep_email", repEmail)
    .eq("is_active", true)
    .single();

  if (repError || !repToken?.google_refresh_token) {
    throw new Error(`No active Google token for ${repEmail}`);
  }

  const vaultSecretId = repToken.google_refresh_token;

  // Step 2: Decrypt the refresh token from Vault
  const { data: vaultRow, error: vaultError } = await client
    .rpc("vault_decrypt", { secret_id: vaultSecretId });

  // Fallback: direct query if RPC not available
  let refreshToken: string;
  if (vaultError) {
    const { data: directRow, error: directError } = await client
      .from("vault.decrypted_secrets" as string)
      .select("decrypted_secret")
      .eq("id", vaultSecretId)
      .single();

    if (directError || !directRow) {
      throw new Error(`Vault decryption failed for ${repEmail}: ${vaultError.message}`);
    }
    refreshToken = (directRow as { decrypted_secret: string }).decrypted_secret;
  } else {
    refreshToken = vaultRow as string;
  }

  // Step 3: Exchange refresh token for access token
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed for ${repEmail}: ${response.status} ${text}`);
  }

  const tokens = await response.json();
  return tokens.access_token as string;
}

/**
 * Makes an authenticated request to a Google API.
 */
export async function googleApiFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}
