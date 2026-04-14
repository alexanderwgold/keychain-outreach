# Google OAuth & Rep Token Flow

Auth is Google OAuth 2.0 scoped to @keychain.com accounts. It is an internal app — no Google app review required since all users are within the same Google Workspace domain.

---

## OAuth scopes

All four scopes are required. Request them in a single OAuth flow:

| Scope | Why needed |
|-------|-----------|
| `https://www.googleapis.com/auth/gmail.readonly` | Scan sent/received emails to detect activity |
| `https://www.googleapis.com/auth/gmail.compose` | Create Gmail drafts with personalized copy + collateral attachments |
| `https://www.googleapis.com/auth/calendar.readonly` | Scan for meetings with contacts |
| `https://www.googleapis.com/auth/calendar.events` | Create follow-up reminders, prep blocks, and outreach windows on rep calendars |

---

## OAuth flow

1. Frontend shows "Sign in with Google" button
2. Rep clicks → frontend redirects to Google OAuth consent URL with all four scopes and `access_type=offline` (required to get a refresh token)
3. Rep grants consent on Google consent screen
4. Google redirects to the `auth-callback` Edge Function with `?code=...&state=...`
5. Edge Function exchanges `code` for `{ access_token, refresh_token }` via `POST https://oauth2.googleapis.com/token`
6. Edge Function calls `https://www.googleapis.com/oauth2/v2/userinfo` with the access token to get the rep's email address
7. Edge Function stores the `refresh_token` encrypted via Supabase Vault; inserts/updates row in `rep_tokens`
8. Edge Function redirects rep to `/dashboard`

---

## Token storage

Refresh tokens are stored encrypted via **Supabase Vault**. Never write a refresh token to a plaintext database column.

```sql
-- Storing a secret via Vault
select vault.create_secret(
  'the-refresh-token-value',
  'rep_token_<rep_email>',  -- name for lookup
  'Google OAuth refresh token for <rep_email>'
);
```

The `rep_tokens.google_refresh_token` column stores the Vault secret ID (UUID), not the token itself. To retrieve the token for API calls:

```sql
select decrypted_secret
from vault.decrypted_secrets
where id = <vault_secret_id>;
```

---

## Using tokens in Edge Functions

Each Edge Function call that needs to make Gmail or Calendar API requests must:

1. Fetch the rep's `google_refresh_token` vault ID from `rep_tokens`
2. Decrypt it via Vault
3. Call `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token` to get a fresh access token
4. Use the access token for Gmail/Calendar API calls

Access tokens expire after 1 hour. Always refresh; do not cache access tokens across function invocations.

---

## Google Cloud project setup

- **Project type:** Internal (Google Workspace, @keychain.com domain)
- **OAuth consent screen:** Internal app — no review required
- **Authorized redirect URI:** must include the `auth-callback` Edge Function URL (e.g., `https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/auth-callback`)
- **Client ID and secret:** stored as Supabase environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) — see `docs/infrastructure.md`
