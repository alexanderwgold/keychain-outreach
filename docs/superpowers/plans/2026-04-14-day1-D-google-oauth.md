# Day 1-D: Google OAuth Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Google Cloud project configured as an internal Workspace app, enable the Gmail and Calendar APIs, create OAuth 2.0 credentials scoped to all four required scopes, and store the Client ID and Secret as Supabase Edge Function secrets.

**Architecture:** Google OAuth is an **Internal** Workspace app scoped to `@keychain.com` accounts. No Google review is required. The `auth-callback` Edge Function (built on Day 2) exchanges the auth code for tokens; its redirect URI must be registered here. Credentials are stored as Supabase secrets — never in code or `.env` files.

**Tech Stack:** Google Cloud Console (manual UI steps), Supabase Dashboard (secret storage), Supabase MCP (verification)

**Independence:** This plan has no dependencies on Plans A–C. It can run in parallel.

---

## Files produced

No code files. This plan produces two Supabase Edge Function secrets:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

---

### Task 1: Create the Google Cloud project

- [ ] **Step 1: Open Google Cloud Console**

Go to [console.cloud.google.com](https://console.cloud.google.com). Sign in with your `@keychain.com` Google account.

- [ ] **Step 2: Create a new project**

Click the project dropdown (top-left, next to the Google Cloud logo) → **New Project**.

Fill in:
- **Project name:** `Keychain Outreach`
- **Organization:** `keychain.com` (select your Workspace org)
- **Location:** `keychain.com`

Click **Create**. Wait ~30 seconds for the project to provision, then select it in the dropdown.

- [ ] **Step 3: Confirm you're in the right project**

The project name `Keychain Outreach` should appear in the top-left dropdown. The URL should contain a `project=keychain-outreach-XXXXXX` parameter.

---

### Task 2: Enable Gmail API and Google Calendar API

Both APIs must be explicitly enabled before you can create OAuth credentials that use their scopes.

- [ ] **Step 1: Enable Gmail API**

In the left nav: **APIs & Services** → **Library**.

Search for `Gmail API`. Click it. Click **Enable**.

Wait for the "API enabled" confirmation.

- [ ] **Step 2: Enable Google Calendar API**

Still in the Library, search for `Google Calendar API`. Click it. Click **Enable**.

Wait for the "API enabled" confirmation.

- [ ] **Step 3: Verify both APIs are enabled**

Go to **APIs & Services** → **Enabled APIs & Services**.

Confirm both appear in the list:
- `Gmail API`
- `Google Calendar API`

---

### Task 3: Configure the OAuth consent screen

Because this is a Google Workspace internal app, you select **Internal** — this means only `@keychain.com` accounts can use it and no Google review is required.

- [ ] **Step 1: Open the OAuth consent screen**

**APIs & Services** → **OAuth consent screen**.

- [ ] **Step 2: Select user type**

Select **Internal**. Click **Create**.

- [ ] **Step 3: Fill in app information**

| Field | Value |
|-------|-------|
| App name | `Keychain Outreach` |
| User support email | your `@keychain.com` address |
| App logo | (leave blank) |
| App domain — Home page | (leave blank for now) |
| Developer contact email | your `@keychain.com` address |

Click **Save and Continue**.

- [ ] **Step 4: Add OAuth scopes**

On the Scopes screen, click **Add or Remove Scopes**.

In the search box, add each scope one at a time. After searching, check the box next to each:

| Scope | What to search |
|-------|---------------|
| `https://www.googleapis.com/auth/gmail.readonly` | `gmail.readonly` |
| `https://www.googleapis.com/auth/gmail.compose` | `gmail.compose` |
| `https://www.googleapis.com/auth/calendar.readonly` | `calendar.readonly` |
| `https://www.googleapis.com/auth/calendar.events` | `calendar.events` |

Click **Update**. Confirm all 4 scopes appear in the "Your sensitive and restricted scopes" section.

Click **Save and Continue**.

- [ ] **Step 5: Review summary**

On the Summary screen, verify:
- User type: Internal
- App name: Keychain Outreach
- Scopes: 4 scopes listed

Click **Back to Dashboard**.

---

### Task 4: Create OAuth 2.0 credentials

- [ ] **Step 1: Open Credentials**

**APIs & Services** → **Credentials**.

Click **+ Create Credentials** → **OAuth 2.0 Client IDs**.

- [ ] **Step 2: Configure the client**

| Field | Value |
|-------|-------|
| Application type | `Web application` |
| Name | `Keychain Outreach Server` |
| Authorized JavaScript origins | (leave blank — backend-only flow) |
| Authorized redirect URIs | `https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/auth-callback` |

The redirect URI is the Supabase Edge Function URL for the OAuth callback handler (built on Day 2). It **must** match exactly — trailing slash or http/https mismatch will cause `redirect_uri_mismatch` errors.

Click **Create**.

- [ ] **Step 3: Copy the credentials**

A modal appears with:
- **Your Client ID** — a string ending in `.apps.googleusercontent.com`
- **Your Client Secret** — a short alphanumeric string

Copy both values. You can also click **Download JSON** as a backup.

**Do not commit these values to git.**

---

### Task 5: Store credentials as Supabase Edge Function secrets

- [ ] **Step 1: Open Supabase Edge Function secrets**

Go to [app.supabase.com](https://app.supabase.com) → select the `Keychain Outreach` project (`hjxaqhbkdvckapsqvqcq`) → **Project Settings** → **Edge Functions** → **Secrets**.

- [ ] **Step 2: Add GOOGLE_CLIENT_ID**

Click **Add new secret**.
- Name: `GOOGLE_CLIENT_ID`
- Value: the Client ID copied in Task 4 Step 3

Click **Save**.

- [ ] **Step 3: Add GOOGLE_CLIENT_SECRET**

Click **Add new secret**.
- Name: `GOOGLE_CLIENT_SECRET`
- Value: the Client Secret copied in Task 4 Step 3

Click **Save**.

- [ ] **Step 4: Verify secrets are stored**

Refresh the Edge Functions → Secrets page. Confirm both names appear:
```
GOOGLE_CLIENT_ID     ••••••••••••••
GOOGLE_CLIENT_SECRET ••••••••••••••
```

The values are masked — this is expected. Confirm the names are spelled exactly as above (case-sensitive).

**Alternative: set via Supabase CLI** (if you have it installed)

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID=<your-client-id> \
  GOOGLE_CLIENT_SECRET=<your-client-secret> \
  --project-ref hjxaqhbkdvckapsqvqcq
```

---

### Task 6: Verify the OAuth flow URL is constructable (smoke test)

The `auth-callback` function doesn't exist yet (Day 2), but you can verify the OAuth consent URL format is correct by constructing it manually and opening it in a browser.

- [ ] **Step 1: Construct the URL**

Replace `YOUR_CLIENT_ID` with the actual Client ID:

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=YOUR_CLIENT_ID
  &redirect_uri=https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/auth-callback
  &response_type=code
  &scope=https://www.googleapis.com/auth/gmail.readonly+https://www.googleapis.com/auth/gmail.compose+https://www.googleapis.com/auth/calendar.readonly+https://www.googleapis.com/auth/calendar.events
  &access_type=offline
  &prompt=consent
```

- [ ] **Step 2: Open in browser**

Open the URL in a browser (sign in with your `@keychain.com` account).

Expected: Google shows an OAuth consent screen titled "Keychain Outreach" listing all 4 scopes. The app shows "Internal" badge.

Do NOT click "Allow" — the redirect will fail because `auth-callback` isn't deployed yet. This test only confirms the OAuth app is configured correctly.

If the consent screen shows an error (e.g., `Error 400: redirect_uri_mismatch`), the redirect URI in Task 4 Step 2 doesn't match. Go back to Google Cloud Console → Credentials → edit the client → fix the URI.

---

### Plan D complete

Google OAuth credentials are configured and stored. The `auth-callback` Edge Function that uses them is built in Day 2.

**Day 1 full completion check:** return to [the Day 1 overview](2026-04-14-day1-overview.md) and run the completion checklist.
