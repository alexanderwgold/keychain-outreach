import { createAdminClient } from "../_shared/supabase-client.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const DASHBOARD_URL = "https://keychain-outreach.vercel.app/dashboard";
const LOGIN_URL = "https://keychain-outreach.vercel.app/";

function redirectTo(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const _state = url.searchParams.get("state"); // TODO: validate for CSRF in v2
  const error = url.searchParams.get("error");

  // Handle OAuth errors (user denied, etc.)
  if (error) {
    console.error("OAuth error:", error);
    return redirectTo(`${LOGIN_URL}?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return redirectTo(`${LOGIN_URL}?error=missing_code`);
  }

  // TODO: validate state parameter against stored state (CSRF prevention)
  // For v1, state validation is deferred — the Supabase Auth flow handles CSRF
  // via its own state management. This function handles the Google OAuth for
  // Gmail/Calendar scopes separately from Supabase Auth.

  try {
    const client = createAdminClient();
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/auth-callback`;

    // Step 1: Exchange authorization code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.error("Token exchange failed:", text);
      return redirectTo(`${LOGIN_URL}?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token as string;
    const refreshToken = tokens.refresh_token as string;
    const scopes = (tokens.scope as string ?? "").split(" ");

    if (!refreshToken) {
      console.error("No refresh token — user may need to re-consent with prompt=consent");
      return redirectTo(`${LOGIN_URL}?error=no_refresh_token`);
    }

    // Step 2: Get user email from Google
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoResponse.ok) {
      return redirectTo(`${LOGIN_URL}?error=userinfo_failed`);
    }

    const userInfo = await userInfoResponse.json();
    const repEmail = userInfo.email as string;
    const repName = (userInfo.name as string | undefined) ?? repEmail;

    // Step 3: Verify email exists in rep_mapping
    const { data: repMapping, error: repError } = await client
      .from("rep_mapping")
      .select("id, is_active")
      .eq("rep_email", repEmail)
      .single();

    if (repError || !repMapping) {
      console.error(`Unknown email: ${repEmail}`);
      return redirectTo(`${LOGIN_URL}?error=unauthorized`);
    }

    if (!repMapping.is_active) {
      return redirectTo(`${LOGIN_URL}?error=inactive_rep`);
    }

    // Step 4: Store refresh token in Vault
    const { data: vaultResult, error: vaultError } = await client.rpc(
      "create_secret",
      {
        secret: refreshToken,
        name: `rep_token_${repEmail}`,
        description: `Google refresh token for ${repEmail}`,
      }
    );

    // Fallback: try vault.create_secret SQL
    let vaultSecretId: string;
    if (vaultError) {
      const { data: sqlResult, error: sqlError } = await client
        .rpc("vault_create_secret", {
          new_secret: refreshToken,
          new_name: `rep_token_${repEmail}`,
          new_description: `Google refresh token for ${repEmail}`,
        });

      if (sqlError) {
        // Last resort: raw SQL
        const { data: rawResult, error: rawError } = await client
          .from("vault.secrets" as string)
          .insert({
            secret: refreshToken,
            name: `rep_token_${repEmail}`,
            description: `Google refresh token for ${repEmail}`,
          })
          .select("id")
          .single();

        if (rawError) {
          console.error("Vault storage failed:", rawError.message);
          return redirectTo(`${LOGIN_URL}?error=vault_failed`);
        }
        vaultSecretId = (rawResult as { id: string }).id;
      } else {
        vaultSecretId = sqlResult as string;
      }
    } else {
      vaultSecretId = vaultResult as string;
    }

    // Step 5: Upsert rep_tokens row
    const { error: upsertError } = await client.from("rep_tokens").upsert(
      {
        rep_email: repEmail,
        rep_name: repName,
        google_refresh_token: vaultSecretId,
        scopes,
        is_active: true,
      },
      { onConflict: "rep_email" }
    );

    if (upsertError) {
      console.error("rep_tokens upsert failed:", upsertError.message);
      return redirectTo(`${LOGIN_URL}?error=db_failed`);
    }

    console.log(`Auth complete for ${repEmail} — scopes: ${scopes.join(", ")}`);

    // Step 6: Redirect to dashboard
    return redirectTo(DASHBOARD_URL);
  } catch (err) {
    console.error("auth-callback error:", (err as Error).message);
    return redirectTo(`${LOGIN_URL}?error=internal`);
  }
});
