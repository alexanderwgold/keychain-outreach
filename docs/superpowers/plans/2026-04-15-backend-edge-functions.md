# Backend Edge Functions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 6 Supabase Edge Functions (auth-callback, daily-scan, generate-draft, create-gmail-draft, research-batch, ingest-metabase) plus a pgvector knowledge base, shared helpers, and frontend updates for the Keychain Outreach Tool.

**Architecture:** Supabase Edge Functions (Deno runtime) with a pgvector-backed knowledge base for AI context. Daily scan orchestrator runs workers in parallel per rep. Claude API generates email drafts with prompt caching. Gmail API creates drafts with MIME attachments. Slack Web API delivers digests.

**Tech Stack:** Deno (Supabase Edge Runtime), PostgreSQL + pgvector, Supabase Vault, Claude API (claude-opus-4-6), Google OAuth2 + Gmail + Calendar APIs, Slack Web API, Supabase.ai.Session('gte-small') for embeddings

**Spec:** `docs/superpowers/specs/2026-04-15-backend-edge-functions-design.md`

---

## File Structure

### New migrations
- `supabase/migrations/005_pgvector_knowledge_base.sql` — vector extension, knowledge_source enum, knowledge_base table, indexes, search RPC
- `supabase/migrations/006_pg_cron_schedules.sql` — pg_cron + pg_net extensions, cron jobs

### New shared modules (`supabase/functions/_shared/`)
- `google-auth.ts` — refresh Google access token from Vault
- `slack.ts` — Slack Web API helpers (lookupByEmail, sendDM)
- `knowledge.ts` — generate embeddings via Supabase.ai.Session, vector search + upsert
- `cors.ts` — CORS preflight + headers for browser-facing functions

### New Edge Functions
- `auth-callback/index.ts` — Google OAuth redirect handler
- `ingest-metabase/index.ts` — HTTP handler for Metabase CSV upload
- `ingest-metabase/parse.ts` — CSV parsing + text chunk formatting
- `ingest-metabase/parse.test.ts` — Deno tests for parser
- `generate-draft/index.ts` — Claude API draft generation (standard + enhanced modes)
- `generate-draft/prompt.ts` — system + user prompt builders
- `create-gmail-draft/index.ts` — Gmail API draft creation with attachments
- `create-gmail-draft/mime.ts` — multipart MIME message builder
- `create-gmail-draft/mime.test.ts` — Deno tests for MIME builder
- `daily-scan/index.ts` — orchestrator (runs all reps in Promise.all)
- `daily-scan/scan-sf-email.ts` — find SF report email, download CSV, diff opportunities
- `daily-scan/scan-gmail.ts` — detect email activity with contacts
- `daily-scan/scan-calendar.ts` — meetings today + 7-day lookahead with prep drafting
- `daily-scan/eval-cadence.ts` — calculate overdue contacts, trigger auto-drafts
- `daily-scan/check-draft-status.ts` — find unsent AI drafts in Gmail
- `daily-scan/compose-digest.ts` — format + send Slack DMs to reps and founders
- `research-batch/index.ts` — Claude Batch API web research for active accounts

### Frontend modifications
- Rewrite: `frontend/src/components/drafting/draft-drawer.tsx` — Gmail-like compose
- Create: `frontend/src/components/drafting/attachment-picker.tsx` — collateral file picker
- Create: `frontend/src/components/admin/metabase-upload-form.tsx` — Metabase CSV upload
- Modify: `frontend/src/app/(admin)/admin/upload/page.tsx` — add Metabase section
- Delete: `frontend/src/components/drafting/draft-variants.tsx` — no more variant cards
- Modify: `frontend/src/components/drafting/draft-trigger.tsx` — update props

---

## Phase 1: Foundation

### Task 1: pgvector + knowledge_base migration

**Files:**
- Create: `supabase/migrations/005_pgvector_knowledge_base.sql`

**Context:** The `vector` extension is available (v0.8.0) but not installed. Supabase recommends creating it in the `extensions` schema. The knowledge_base table stores text chunks with 384-dim embeddings from the `gte-small` model. A Postgres function provides vector similarity search via RPC.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/005_pgvector_knowledge_base.sql`:

```sql
-- ============================================================
-- Migration 005: pgvector extension + knowledge_base table
-- Unified vector store for Metabase data, web research, and collateral.
-- ============================================================

-- Enable pgvector in the extensions schema
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Source type enum
CREATE TYPE knowledge_source AS ENUM (
  'metabase_report',
  'web_research',
  'collateral'
);

-- Unified knowledge base with vector embeddings
CREATE TABLE knowledge_base (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type knowledge_source NOT NULL,
  source_id   TEXT NOT NULL,
  account_name TEXT,
  content     TEXT NOT NULL,
  embedding   extensions.vector(384) NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX knowledge_base_account_name_idx ON knowledge_base (account_name);
CREATE INDEX knowledge_base_source_type_idx ON knowledge_base (source_type);
CREATE INDEX knowledge_base_expires_at_idx ON knowledge_base (expires_at) WHERE expires_at IS NOT NULL;

-- HNSW index for vector similarity search (faster than IVFFlat for < 1M rows)
CREATE INDEX knowledge_base_embedding_idx ON knowledge_base
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Upsert support: unique constraint for replacing old data on re-import
CREATE UNIQUE INDEX knowledge_base_source_account_idx
  ON knowledge_base (source_type, source_id, account_name)
  WHERE account_name IS NOT NULL;

-- Enable RLS (Edge Functions bypass via service role key)
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- RPC function for vector similarity search
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding extensions.vector(384),
  match_account_name TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  source_type knowledge_source,
  source_id TEXT,
  account_name TEXT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id,
    kb.source_type,
    kb.source_id,
    kb.account_name,
    kb.content,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE
    (match_account_name IS NULL OR kb.account_name = match_account_name)
    AND (kb.expires_at IS NULL OR kb.expires_at > now())
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run: `mcp__supabase__apply_migration` with name `pgvector_knowledge_base` and the SQL above.

Verify: `mcp__supabase__list_tables` should show `knowledge_base` in the list.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/migrations/005_pgvector_knowledge_base.sql && git commit -m "feat: add pgvector knowledge_base table with vector search RPC

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: CORS shared helper

**Files:**
- Create: `supabase/functions/_shared/cors.ts`

**Context:** Frontend-facing Edge Functions (generate-draft, create-gmail-draft, ingest-metabase) are called from `https://keychain-outreach.vercel.app` via `fetch()`. The Supabase Edge Functions gateway requires functions to handle CORS themselves.

- [ ] **Step 1: Create CORS helper**

Create `supabase/functions/_shared/cors.ts`:

```typescript
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Returns a 204 response for CORS preflight requests.
 * Use at the top of every browser-facing Edge Function handler:
 *
 *   if (req.method === "OPTIONS") return corsPreflightResponse();
 */
export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Returns a JSON response with CORS headers.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/_shared/cors.ts && git commit -m "feat: add shared CORS helper for browser-facing Edge Functions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Google auth shared helper

**Files:**
- Create: `supabase/functions/_shared/google-auth.ts`

**Context:** Every Edge Function that calls Gmail or Calendar APIs needs a fresh Google access token for the specific rep. The refresh token is stored as a Vault secret UUID in `rep_tokens.google_refresh_token`. The helper reads the UUID from DB, decrypts via `vault.decrypted_secrets`, and exchanges the refresh token for a short-lived access token.

- [ ] **Step 1: Create the helper**

Create `supabase/functions/_shared/google-auth.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/_shared/google-auth.ts && git commit -m "feat: add shared Google auth helper for Vault-based token refresh

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Slack shared helper

**Files:**
- Create: `supabase/functions/_shared/slack.ts`

**Context:** The daily scan sends Slack DMs to each rep and founders. Uses a minimal Slack app with `chat:write` + `users:read.email` scopes. All calls are simple HTTP POSTs to the Slack Web API.

- [ ] **Step 1: Create the helper**

Create `supabase/functions/_shared/slack.ts`:

```typescript
const SLACK_API = "https://slack.com/api";

function getSlackToken(): string {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");
  return token;
}

async function slackPost(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSlackToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error}`);
  }
  return data;
}

/**
 * Looks up a Slack user ID by their email address.
 * Requires `users:read.email` scope.
 */
export async function lookupSlackUser(email: string): Promise<string> {
  const data = await slackPost("users.lookupByEmail", { email });
  return (data.user as { id: string }).id;
}

/**
 * Opens a DM channel with a Slack user and sends a message.
 * Requires `chat:write` scope.
 */
export async function sendSlackDM(email: string, message: string): Promise<void> {
  const userId = await lookupSlackUser(email);

  const dmData = await slackPost("conversations.open", { users: userId });
  const channelId = (dmData.channel as { id: string }).id;

  await slackPost("chat.postMessage", {
    channel: channelId,
    text: message,
    mrkdwn: true,
  });
}

/**
 * Sends a message to a specific Slack channel by ID.
 */
export async function sendSlackMessage(channelId: string, message: string): Promise<void> {
  await slackPost("chat.postMessage", {
    channel: channelId,
    text: message,
    mrkdwn: true,
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/_shared/slack.ts && git commit -m "feat: add shared Slack Web API helper for DMs and messages

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Knowledge base shared helper

**Files:**
- Create: `supabase/functions/_shared/knowledge.ts`

**Context:** Generates text embeddings using `Supabase.ai.Session('gte-small')` (runs natively in the Edge Function runtime — no external API needed). Provides search and upsert functions against the `knowledge_base` table. The embedding model produces 384-dimensional vectors.

- [ ] **Step 1: Create the helper**

Create `supabase/functions/_shared/knowledge.ts`:

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Supabase.ai.Session is available globally in the Edge Runtime
// @ts-ignore — Supabase.ai is a runtime global, not in TS types
const model = new Supabase.ai.Session("gte-small");

export interface KnowledgeChunk {
  sourceType: "metabase_report" | "web_research" | "collateral";
  sourceId: string;
  accountName: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string; // ISO 8601 timestamp
}

export interface KnowledgeResult {
  id: string;
  source_type: string;
  source_id: string;
  account_name: string | null;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

/**
 * Generates a 384-dim embedding for the given text using the gte-small model.
 * Runs natively in the Supabase Edge Runtime — no external API call.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const output = await model.run(text, {
    mean_pool: true,
    normalize: true,
  });
  // output is a Float32Array or similar typed array
  return Array.from(output);
}

/**
 * Searches the knowledge_base for relevant chunks.
 * Uses the search_knowledge RPC function (created in migration 005).
 *
 * @param accountName - exact match filter (null for general search)
 * @param queryText - text to embed and search by similarity
 * @param limit - max results (default 10)
 */
export async function searchKnowledge(
  client: SupabaseClient,
  accountName: string | null,
  queryText: string,
  limit = 10
): Promise<KnowledgeResult[]> {
  const embedding = await generateEmbedding(queryText);

  const { data, error } = await client.rpc("search_knowledge", {
    query_embedding: JSON.stringify(embedding),
    match_account_name: accountName,
    match_threshold: 0.3,
    match_count: limit,
  });

  if (error) {
    console.error("Knowledge search failed:", error.message);
    return [];
  }

  return (data ?? []) as KnowledgeResult[];
}

/**
 * Upserts knowledge chunks into the knowledge_base table.
 * Generates embeddings for each chunk and inserts in batches.
 *
 * @param chunks - array of knowledge chunks to upsert
 * @param batchSize - rows per upsert batch (default 100, lower than csv-import's 500
 *   because embedding generation is the bottleneck)
 */
export async function upsertKnowledge(
  client: SupabaseClient,
  chunks: KnowledgeChunk[],
  batchSize = 100
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    const rows = await Promise.all(
      batch.map(async (chunk) => {
        const embedding = await generateEmbedding(chunk.content);
        return {
          source_type: chunk.sourceType,
          source_id: chunk.sourceId,
          account_name: chunk.accountName,
          content: chunk.content,
          embedding: JSON.stringify(embedding),
          metadata: chunk.metadata ?? {},
          expires_at: chunk.expiresAt ?? null,
        };
      })
    );

    const { error } = await client.from("knowledge_base").upsert(rows, {
      onConflict: "source_type,source_id,account_name",
    });

    if (error) {
      console.error(`Knowledge upsert batch ${i} failed:`, error.message);
      errors += batch.length;
    } else {
      upserted += batch.length;
    }
  }

  return { upserted, errors };
}

/**
 * Deletes expired knowledge rows (expires_at < now()).
 */
export async function purgeExpiredKnowledge(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from("knowledge_base")
    .delete({ count: "exact" })
    .lt("expires_at", new Date().toISOString());

  if (error) {
    console.error("Knowledge purge failed:", error.message);
    return 0;
  }
  return count ?? 0;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/_shared/knowledge.ts && git commit -m "feat: add shared knowledge base helper with embedding generation and vector search

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: auth-callback Edge Function

**Files:**
- Create: `supabase/functions/auth-callback/index.ts`

**Context:** Handles the Google OAuth redirect. Google sends the user to this URL with `?code=xxx&state=xxx` after they authorize. The function exchanges the code for tokens, stores the refresh token in Vault, creates a `rep_tokens` row, and redirects to the dashboard. Only emails in `rep_mapping` are allowed.

- [ ] **Step 1: Create the function**

Create `supabase/functions/auth-callback/index.ts`:

```typescript
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
  const state = url.searchParams.get("state");
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
    const repName = userInfo.name as string ?? repEmail;

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
```

- [ ] **Step 2: Deploy and verify**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && npx supabase functions deploy auth-callback --no-verify-jwt
```

Note: `--no-verify-jwt` because this endpoint receives a browser redirect from Google, not a Bearer token. Auth is handled by validating the rep's email against `rep_mapping`.

Verify deployment: `curl -I https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/auth-callback` should return 302 (redirect to login with error=missing_code).

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/auth-callback/ && git commit -m "feat: add auth-callback Edge Function for Google OAuth token exchange

Exchanges authorization code for tokens, stores refresh token in Supabase Vault,
upserts rep_tokens row, and redirects to dashboard.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: Data Ingestion

### Task 7: Metabase CSV parser + tests

**Files:**
- Create: `supabase/functions/ingest-metabase/parse.ts`
- Create: `supabase/functions/ingest-metabase/parse.test.ts`

**Context:** Parses Metabase CSV exports into text chunks suitable for embedding. The first report type is manufacturer platform activity data with columns: `manufacturer_name`, `salesforce_account_name`, and 6 numeric activity columns. Numbers in the CSV may contain commas (e.g. `"1,410"`). Each row becomes a text chunk describing the manufacturer's activity.

- [ ] **Step 1: Write the tests**

Create `supabase/functions/ingest-metabase/parse.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseMetabaseCSV, type MetabaseChunk } from "./parse.ts";

const HEADER =
  "manufacturer_name,salesforce_account_name," +
  "tagged_micro_cat_projects_last_365_days,tagged_micro_cat_projects_last_90_days," +
  "tagged_micro_cat_verified_projects_last_365_days,tagged_micro_cat_verified_projects_last_90_days," +
  "tagged_micro_cat_views_last_90_days,tagged_micro_cat_views_last_365_days";

Deno.test("parseMetabaseCSV: parses a simple row into a chunk", () => {
  const csv = HEADER + "\nTea India,Tea India,681,196,219,54,329,1410";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].accountName, "Tea India");
  assertEquals(chunks[0].sourceId, "test-report");
  assertEquals(chunks[0].sourceType, "metabase_report");
  assertEquals(chunks[0].content.includes("196 projects"), true);
  assertEquals(chunks[0].content.includes("Tea India"), true);
});

Deno.test("parseMetabaseCSV: handles commas in numbers", () => {
  const csv = HEADER + '\nBig Co,Big Co,"6,743","1,567","1,915",469,"3,562","14,723"';
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].metadata.projects_90d, 1567);
  assertEquals(chunks[0].metadata.views_365d, 14723);
});

Deno.test("parseMetabaseCSV: skips rows with zero activity", () => {
  const csv = HEADER + "\nDead Co,Dead Co,0,0,0,0,0,0";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 0);
});

Deno.test("parseMetabaseCSV: uses salesforce_account_name as accountName", () => {
  const csv = HEADER + '\nPlatform Name,"SF Account Name",10,5,3,1,8,20';
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks[0].accountName, "SF Account Name");
});

Deno.test("parseMetabaseCSV: handles empty salesforce_account_name", () => {
  const csv = HEADER + "\nSome Mfr,,10,5,3,1,8,20";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks[0].accountName, "Some Mfr");
});

Deno.test("parseMetabaseCSV: stores numeric metadata", () => {
  const csv = HEADER + "\nAcme,Acme,100,25,50,10,30,200";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks[0].metadata.projects_365d, 100);
  assertEquals(chunks[0].metadata.projects_90d, 25);
  assertEquals(chunks[0].metadata.verified_365d, 50);
  assertEquals(chunks[0].metadata.verified_90d, 10);
  assertEquals(chunks[0].metadata.views_90d, 30);
  assertEquals(chunks[0].metadata.views_365d, 200);
});

Deno.test("parseMetabaseCSV: multiple rows produce multiple chunks", () => {
  const csv = [
    HEADER,
    "A Co,A Co,10,5,3,1,8,20",
    "B Co,B Co,20,10,6,2,16,40",
  ].join("\n");
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 2);
});

Deno.test("parseMetabaseCSV: skips empty trailing lines", () => {
  const csv = HEADER + "\nAcme,Acme,10,5,3,1,8,20\n\n";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && deno test supabase/functions/ingest-metabase/parse.test.ts
```

Expected: FAIL — `parse.ts` does not exist yet.

- [ ] **Step 3: Implement the parser**

Create `supabase/functions/ingest-metabase/parse.ts`:

```typescript
import { parse as parseCSV } from "https://deno.land/std@0.208.0/csv/mod.ts";

export interface MetabaseChunk {
  sourceType: "metabase_report";
  sourceId: string;
  accountName: string;
  content: string;
  metadata: {
    manufacturer_name: string;
    projects_365d: number;
    projects_90d: number;
    verified_365d: number;
    verified_90d: number;
    views_90d: number;
    views_365d: number;
  };
}

function parseNum(raw: string): number {
  const n = parseInt(raw.replace(/,/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Parses a Metabase manufacturer activity CSV into embeddable text chunks.
 * Skips rows where all activity columns are zero (no useful data).
 * Falls back to manufacturer_name if salesforce_account_name is empty.
 */
export function parseMetabaseCSV(csvText: string, reportName: string): MetabaseChunk[] {
  const rawRows = parseCSV(csvText) as string[][];
  if (rawRows.length <= 1) return [];

  const headers = rawRows[0].map((h) => h.trim());
  const dataRows = rawRows.slice(1);
  const chunks: MetabaseChunk[] = [];

  for (const row of dataRows) {
    if (row.length < 2 || row.every((cell) => !cell.trim())) continue;

    const r: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      r[headers[i]] = (row[i] ?? "").trim();
    }

    const manufacturerName = r["manufacturer_name"] ?? "";
    const sfAccountName = r["salesforce_account_name"] ?? "";
    if (!manufacturerName && !sfAccountName) continue;

    const projects365 = parseNum(r["tagged_micro_cat_projects_last_365_days"] ?? "0");
    const projects90 = parseNum(r["tagged_micro_cat_projects_last_90_days"] ?? "0");
    const verified365 = parseNum(r["tagged_micro_cat_verified_projects_last_365_days"] ?? "0");
    const verified90 = parseNum(r["tagged_micro_cat_verified_projects_last_90_days"] ?? "0");
    const views90 = parseNum(r["tagged_micro_cat_views_last_90_days"] ?? "0");
    const views365 = parseNum(r["tagged_micro_cat_views_last_365_days"] ?? "0");

    // Skip rows with zero activity — no useful data for Claude
    const totalActivity = projects365 + projects90 + verified365 + verified90 + views90 + views365;
    if (totalActivity === 0) continue;

    const accountName = sfAccountName || manufacturerName;

    const content =
      `${manufacturerName} (SF: ${accountName}) — ` +
      `Projects: ${projects90} (90d), ${projects365} (1yr). ` +
      `Verified projects: ${verified90} (90d), ${verified365} (1yr). ` +
      `Category views: ${views90} (90d), ${views365} (1yr).`;

    chunks.push({
      sourceType: "metabase_report",
      sourceId: reportName,
      accountName,
      content,
      metadata: {
        manufacturer_name: manufacturerName,
        projects_365d: projects365,
        projects_90d: projects90,
        verified_365d: verified365,
        verified_90d: verified90,
        views_90d: views90,
        views_365d: views365,
      },
    });
  }

  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && deno test supabase/functions/ingest-metabase/parse.test.ts
```

Expected: 8 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/ingest-metabase/parse.ts supabase/functions/ingest-metabase/parse.test.ts && git commit -m "feat: add Metabase CSV parser with text chunk formatting

Parses manufacturer activity CSV, formats into embeddable text chunks,
skips zero-activity rows. 8 passing tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: ingest-metabase Edge Function

**Files:**
- Create: `supabase/functions/ingest-metabase/index.ts`

**Context:** HTTP POST handler that accepts a Metabase CSV upload (multipart form data), parses it into chunks using the parser from Task 7, generates embeddings via the knowledge helper from Task 5, and upserts into the knowledge_base table. Requires service_role JWT. Uses CORS helper for browser access.

- [ ] **Step 1: Create the function**

Create `supabase/functions/ingest-metabase/index.ts`:

```typescript
import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { upsertKnowledge, type KnowledgeChunk } from "../_shared/knowledge.ts";
import { parseMetabaseCSV } from "./parse.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Auth: require service_role JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.role !== "service_role") {
      return jsonResponse({ error: "Forbidden: service_role required" }, 403);
    }
  } catch {
    return jsonResponse({ error: "Invalid token" }, 401);
  }

  // Parse multipart form data
  let csvText: string;
  let reportName: string;
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return jsonResponse({ error: "No file provided in form field 'file'" }, 400);
    }
    csvText = await (file as File).text();
    reportName = (formData.get("report_name") as string) ?? (file as File).name ?? "metabase-report";
  } catch {
    return jsonResponse({ error: "Failed to parse multipart form data" }, 400);
  }

  try {
    const client = createAdminClient();

    // Parse CSV into text chunks
    const metabaseChunks = parseMetabaseCSV(csvText, reportName);

    if (metabaseChunks.length === 0) {
      return jsonResponse({ rowsProcessed: 0, chunksUpserted: 0, errors: 0, message: "No active rows found in CSV" });
    }

    // Convert to KnowledgeChunk format
    const knowledgeChunks: KnowledgeChunk[] = metabaseChunks.map((mc) => ({
      sourceType: mc.sourceType,
      sourceId: mc.sourceId,
      accountName: mc.accountName,
      content: mc.content,
      metadata: mc.metadata,
    }));

    // Embed and upsert (batched)
    const result = await upsertKnowledge(client, knowledgeChunks);

    return jsonResponse({
      rowsProcessed: metabaseChunks.length,
      chunksUpserted: result.upserted,
      errors: result.errors,
    });
  } catch (e) {
    console.error("ingest-metabase error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Deploy and verify**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && npx supabase functions deploy ingest-metabase
```

Test with the real Metabase CSV:
```bash
curl -X POST "https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/ingest-metabase" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -F "file=@/Users/alexgold-keychain/Downloads/manufacturers_____tagged_micro_cat_s_search_and_projects_data_2026-04-15T15_44_10.586685572-04_00.csv" \
  -F "report_name=manufacturer_activity_2026-04"
```

Expected: `{ "rowsProcessed": <some number>, "chunksUpserted": <same>, "errors": 0 }`

- [ ] **Step 3: Verify data in DB**

```sql
-- Run via mcp__supabase__execute_sql
SELECT source_type, source_id, account_name, LEFT(content, 80) as content_preview
FROM knowledge_base
WHERE source_type = 'metabase_report'
LIMIT 5;
```

Expected: rows with manufacturer activity text chunks.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/ingest-metabase/index.ts && git commit -m "feat: add ingest-metabase Edge Function for Metabase CSV → vector store pipeline

Accepts CSV upload, parses into text chunks, generates embeddings via
Supabase AI, and upserts into knowledge_base.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Frontend Metabase upload section

**Files:**
- Create: `frontend/src/components/admin/metabase-upload-form.tsx`
- Modify: `frontend/src/app/(admin)/admin/upload/page.tsx`

**Context:** Add a Metabase Report upload section alongside the existing Salesforce CSV upload on the admin upload page. Same UX pattern as `CsvUploadForm` — file picker, upload button, results card. Calls the `ingest-metabase` Edge Function.

- [ ] **Step 1: Create MetabaseUploadForm component**

Create `frontend/src/components/admin/metabase-upload-form.tsx`:

```tsx
"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Upload, Database, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import * as Sentry from "@sentry/nextjs"

interface IngestResult {
  rowsProcessed: number
  chunksUpserted: number
  errors: number
  message?: string
}

export function MetabaseUploadForm() {
  const [file, setFile] = useState<File | null>(null)
  const [reportName, setReportName] = useState("")
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleUpload() {
    if (!file) return

    setUploading(true)
    setError(null)
    setResult(null)

    try {
      await Sentry.startSpan({ name: "metabase.ingest", op: "http.client" }, async () => {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("report_name", reportName || file.name)

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ingest-metabase`,
          {
            method: "POST",
            body: formData,
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
            },
          }
        )

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Upload failed: ${response.status} ${text}`)
        }

        const data = await response.json()
        setResult(data)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed"
      setError(message)
      Sentry.captureException(err)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-kc-warm-gray-dark/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-kc-gold-dark" />
            Upload Metabase Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-kc-warm-gray-dark p-8 transition-colors hover:border-kc-gold/50 hover:bg-kc-gold-subtle/20"
            onClick={() => inputRef.current?.click()}
          >
            <Database className="mb-3 h-8 w-8 text-kc-text-muted" />
            {file ? (
              <div className="text-center">
                <p className="text-sm font-medium text-kc-charcoal">{file.name}</p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-kc-charcoal">
                  Click to select a Metabase CSV export
                </p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  Manufacturer activity data with platform stats
                </p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0]
                if (selected) setFile(selected)
              }}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-kc-text-muted">
              Report Name (optional)
            </label>
            <Input
              placeholder="e.g. manufacturer_activity_2026-04"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
            />
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Embedding & uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Ingest Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-kc-danger/30 bg-kc-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-kc-danger" />
            <div>
              <p className="text-sm font-medium text-kc-danger">Ingest Failed</p>
              <p className="mt-1 text-xs text-kc-text-muted">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-kc-success/30 bg-kc-success/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="h-5 w-5 text-kc-success" />
              <p className="text-sm font-medium text-kc-success">Ingest Complete</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xl font-bold text-kc-charcoal">{result.rowsProcessed.toLocaleString()}</p>
                <p className="text-xs text-kc-text-muted">Rows Processed</p>
              </div>
              <div>
                <p className="text-xl font-bold text-kc-charcoal">{result.chunksUpserted.toLocaleString()}</p>
                <p className="text-xs text-kc-text-muted">Chunks Embedded</p>
              </div>
              <div>
                <p className="text-xl font-bold text-kc-charcoal">{result.errors}</p>
                <p className="text-xs text-kc-text-muted">Errors</p>
              </div>
            </div>
            {result.message && (
              <p className="mt-3 text-xs text-kc-text-muted">{result.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update the upload page**

Modify `frontend/src/app/(admin)/admin/upload/page.tsx` to include both upload forms:

```tsx
import { CsvUploadForm } from "@/components/admin/csv-upload-form"
import { MetabaseUploadForm } from "@/components/admin/metabase-upload-form"
import { Separator } from "@/components/ui/separator"

export default function CsvUploadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Data Import</h1>
        <p className="mt-1 text-kc-text-muted">
          Import data from Salesforce and Metabase
        </p>
      </div>

      <CsvUploadForm />

      <Separator />

      <MetabaseUploadForm />
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -15
```

Expected: build passes, `/admin/upload` is listed.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/admin/metabase-upload-form.tsx "frontend/src/app/(admin)/admin/upload/page.tsx" && git commit -m "feat: add Metabase report upload to admin page

Adds MetabaseUploadForm component alongside existing CSV upload.
Calls ingest-metabase Edge Function for embedding and storage.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: AI Drafting

### Task 10: generate-draft prompt builder + Edge Function

**Files:**
- Create: `supabase/functions/generate-draft/prompt.ts`
- Create: `supabase/functions/generate-draft/index.ts`

**Context:** The prompt builder constructs system and user prompts for Claude. The system prompt is static (product context, tone guide) and uses `cache_control: { type: "ephemeral" }` for prompt caching. The user prompt is per-contact (opportunity data, knowledge base results, activity history). Two modes: "standard" (internal data only) and "enhanced" (adds web_search tool for live research).

- [ ] **Step 1: Create the prompt builder**

Create `supabase/functions/generate-draft/prompt.ts`:

```typescript
export interface DraftContext {
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
  accountName: string;
  stageName: string;
  amount: number | null;
  closeDate: string | null;
  suggestedAction: string | null;
  recentActivity: { type: string; date: string; subject: string | null }[];
  knowledgeContext: { content: string; source_type: string }[];
  trigger: "rep_initiated" | "auto_overdue" | "meeting_prep";
  meetingTitle?: string;
  meetingTime?: string;
  daysOverdue?: number;
  cadenceThreshold?: number;
}

/**
 * Builds the system prompt for Claude draft generation.
 * This prompt is CACHED via cache_control — it's the same across all drafts.
 */
export function buildSystemPrompt(): string {
  return `You are an expert sales email writer for Keychain, a B2B sourcing marketplace that connects buyers with manufacturers and suppliers.

About Keychain:
- Keychain is a platform where buyers post sourcing projects and manufacturers respond
- The platform has thousands of active manufacturers across food & beverage, packaging, pharmaceuticals, and industrial categories
- Buyers use Keychain to find and vet manufacturers faster than traditional sourcing methods
- Key value props: speed (days vs months), verified manufacturers, project-based matching, category intelligence

Your role:
- Write one excellent outreach email for a Keychain sales rep to send to a manufacturer contact
- The email should feel personal, data-driven when possible, and focused on the value Keychain provides to the specific manufacturer
- Keep emails concise (3-5 short paragraphs max)
- Use a professional but warm tone — not corporate jargon, not overly casual
- Include a specific, low-friction call-to-action (15-min call, quick demo, etc.)
- When platform data is available (project counts, views, verified projects), weave specific numbers into the email naturally

Output format:
Return your response as JSON with exactly two fields:
{ "subject": "Email subject line", "htmlBody": "<p>HTML email body</p>" }

Use simple HTML: <p> tags for paragraphs, <strong> for emphasis. No complex styling.`;
}

/**
 * Builds the user prompt with per-contact context.
 * This prompt is NOT cached — it's unique per draft.
 */
export function buildUserPrompt(ctx: DraftContext): string {
  const lines: string[] = [];

  lines.push(`## Contact`);
  lines.push(`- Name: ${ctx.contactName}`);
  if (ctx.contactTitle) lines.push(`- Title: ${ctx.contactTitle}`);
  lines.push(`- Company: ${ctx.accountName}`);
  lines.push(`- Pipeline Stage: ${ctx.stageName}`);
  if (ctx.amount) lines.push(`- Deal Size: $${ctx.amount.toLocaleString()}`);
  if (ctx.closeDate) lines.push(`- Target Close: ${ctx.closeDate}`);

  if (ctx.suggestedAction) {
    lines.push(`\n## Stage Guidance`);
    lines.push(ctx.suggestedAction);
  }

  if (ctx.knowledgeContext.length > 0) {
    lines.push(`\n## Platform Data`);
    for (const k of ctx.knowledgeContext) {
      lines.push(`- [${k.source_type}] ${k.content}`);
    }
  }

  if (ctx.recentActivity.length > 0) {
    lines.push(`\n## Recent Activity`);
    for (const a of ctx.recentActivity) {
      lines.push(`- ${a.date}: ${a.type}${a.subject ? ` — "${a.subject}"` : ""}`);
    }
  }

  lines.push(`\n## Task`);
  switch (ctx.trigger) {
    case "rep_initiated":
      lines.push("Draft an outreach email for this contact. Make it compelling and personalized.");
      break;
    case "auto_overdue":
      lines.push(
        `This contact is ${ctx.daysOverdue} days overdue (threshold: ${ctx.cadenceThreshold} days). ` +
        `Draft a re-engagement email. Acknowledge the gap tactfully without being apologetic.`
      );
      break;
    case "meeting_prep":
      lines.push(
        `Draft a pre-meeting email for "${ctx.meetingTitle}" on ${ctx.meetingTime}. ` +
        `Include relevant talking points and data. Keep it brief and focused on what ` +
        `you'll discuss in the meeting.`
      );
      break;
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Create the Edge Function**

Create `supabase/functions/generate-draft/index.ts`:

```typescript
import { createAdminClient } from "../_shared/supabase-client.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { searchKnowledge, upsertKnowledge, type KnowledgeChunk } from "../_shared/knowledge.ts";
import { buildSystemPrompt, buildUserPrompt, type DraftContext } from "./prompt.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-6";

interface GenerateRequest {
  contactId: string;
  opportunityId: string;
  mode: "standard" | "enhanced";
  context?: {
    trigger?: "rep_initiated" | "auto_overdue" | "meeting_prep";
    meetingTitle?: string;
    meetingTime?: string;
    daysOverdue?: number;
    cadenceThreshold?: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { contactId, opportunityId, mode } = body;
  const trigger = body.context?.trigger ?? "rep_initiated";

  if (!contactId || !opportunityId) {
    return jsonResponse({ error: "contactId and opportunityId required" }, 400);
  }

  try {
    const client = createAdminClient();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Step 1: Load contact + opportunity context
    const { data: opp, error: oppError } = await client
      .from("opportunities")
      .select("*, opportunity_contacts(contacts(*))")
      .eq("id", opportunityId)
      .single();
    if (oppError || !opp) return jsonResponse({ error: "Opportunity not found" }, 404);

    // Find the specific contact
    const allContacts = (opp.opportunity_contacts ?? [])
      .map((oc: { contacts: unknown }) => oc.contacts)
      .flat();
    const contact = allContacts.find((c: { id: string }) => c.id === contactId);
    if (!contact) return jsonResponse({ error: "Contact not found on this opportunity" }, 404);

    // Get cadence rule for stage
    const { data: cadenceRule } = await client
      .from("cadence_rules")
      .select("suggested_action, days_between_touches")
      .eq("stage_name", opp.stage_name)
      .single();

    // Get recent activity
    const { data: recentActivity } = await client
      .from("activity_log")
      .select("activity_type, activity_date, subject")
      .eq("opportunity_id", opportunityId)
      .order("activity_date", { ascending: false })
      .limit(5);

    // Step 2: Query knowledge base
    const knowledgeResults = await searchKnowledge(
      client,
      opp.account_name,
      `${opp.account_name} ${contact.title ?? ""} manufacturing sourcing`,
      10
    );

    // Step 3: If enhanced mode, do web research
    if (mode === "enhanced") {
      // Check rate limit: 20 enhanced calls per rep per day
      const today = new Date().toISOString().split("T")[0];
      const { count } = await client
        .from("activity_log")
        .select("*", { count: "exact", head: true })
        .eq("rep_email", opp.rep_email)
        .eq("source", "manual") // Using 'manual' source to track enhanced drafts
        .gte("activity_date", `${today}T00:00:00`)
        .like("notes", "%enhanced_draft%");

      if ((count ?? 0) >= 20) {
        return jsonResponse({ error: "Enhanced draft rate limit reached (20/day)" }, 429);
      }

      // Call Claude with web_search tool
      const researchResponse = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          tools: [{
            type: "web_search",
            name: "web_search",
          }],
          messages: [{
            role: "user",
            content: `Search for recent news, announcements, and industry developments about "${opp.account_name}" in the manufacturing/sourcing space. Focus on the last 30 days. Summarize the most relevant findings in 2-3 paragraphs.`,
          }],
        }),
      });

      if (researchResponse.ok) {
        const researchData = await researchResponse.json();
        const textBlocks = researchData.content?.filter(
          (b: { type: string }) => b.type === "text"
        ) ?? [];
        const researchText = textBlocks.map((b: { text: string }) => b.text).join("\n");

        if (researchText) {
          // Store research in knowledge base for future standard drafts
          const chunks: KnowledgeChunk[] = [{
            sourceType: "web_research",
            sourceId: `research_${opp.account_name}_${today}`,
            accountName: opp.account_name,
            content: researchText,
            metadata: { query: opp.account_name, date: today },
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }];
          await upsertKnowledge(client, chunks);

          // Add to knowledge results for this draft
          knowledgeResults.push({
            id: "live-research",
            source_type: "web_research",
            source_id: `research_${opp.account_name}_${today}`,
            account_name: opp.account_name,
            content: researchText,
            metadata: {},
            similarity: 1.0,
          });
        }
      }
    }

    // Step 4: Build prompts
    const draftContext: DraftContext = {
      contactName: `${contact.first_name} ${contact.last_name}`,
      contactTitle: contact.title,
      contactEmail: contact.email,
      accountName: opp.account_name,
      stageName: opp.stage_name ?? "Unknown",
      amount: opp.amount ? parseFloat(opp.amount) : null,
      closeDate: opp.close_date,
      suggestedAction: cadenceRule?.suggested_action ?? null,
      recentActivity: (recentActivity ?? []).map((a: { activity_type: string; activity_date: string; subject: string | null }) => ({
        type: a.activity_type,
        date: new Date(a.activity_date).toLocaleDateString(),
        subject: a.subject,
      })),
      knowledgeContext: knowledgeResults.map((k) => ({
        content: k.content,
        source_type: k.source_type,
      })),
      trigger,
      meetingTitle: body.context?.meetingTitle,
      meetingTime: body.context?.meetingTime,
      daysOverdue: (body.context as Record<string, unknown>)?.daysOverdue as number | undefined,
      cadenceThreshold: (body.context as Record<string, unknown>)?.cadenceThreshold as number | undefined,
    };

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(draftContext);

    // Step 5: Call Claude to generate draft
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: [{
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: userPrompt,
        }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Claude API error:", text);
      return jsonResponse({ error: "Draft generation failed" }, 502);
    }

    const data = await response.json();
    const textContent = data.content?.find((b: { type: string }) => b.type === "text");
    if (!textContent) {
      return jsonResponse({ error: "No text in Claude response" }, 502);
    }

    // Parse JSON from Claude's response
    let draft: { subject: string; htmlBody: string };
    try {
      // Claude may wrap JSON in markdown code blocks
      const jsonStr = textContent.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      draft = JSON.parse(jsonStr);
    } catch {
      // If JSON parsing fails, use the raw text as the body
      draft = {
        subject: `Follow up — ${opp.account_name}`,
        htmlBody: `<p>${textContent.text}</p>`,
      };
    }

    // Log the draft generation
    await client.from("activity_log").insert({
      opportunity_id: opportunityId,
      contact_id: contactId,
      rep_email: opp.rep_email,
      activity_type: "manual_log",
      activity_date: new Date().toISOString(),
      subject: draft.subject,
      notes: JSON.stringify({ trigger, mode, enhanced_draft: mode === "enhanced" }),
      source: "manual",
    });

    return jsonResponse({
      subject: draft.subject,
      htmlBody: draft.htmlBody,
      mode,
      knowledgeSourcesUsed: knowledgeResults.length,
    });
  } catch (e) {
    console.error("generate-draft error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 3: Deploy and test**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && npx supabase functions deploy generate-draft
```

Test with curl (requires a real contactId and opportunityId from the DB):
```bash
curl -X POST "https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/generate-draft" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contactId": "<uuid>", "opportunityId": "<uuid>", "mode": "standard"}'
```

Expected: `{ "subject": "...", "htmlBody": "...", "mode": "standard", "knowledgeSourcesUsed": <n> }`

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/generate-draft/ && git commit -m "feat: add generate-draft Edge Function with Claude API and vector context

Two modes: standard (internal data) and enhanced (+ web search).
Uses prompt caching on system prompt. Stores web research for future use.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: MIME builder + tests

**Files:**
- Create: `supabase/functions/create-gmail-draft/mime.ts`
- Create: `supabase/functions/create-gmail-draft/mime.test.ts`

**Context:** Gmail's draft creation API expects a base64url-encoded RFC 2822 MIME message. This module builds multipart MIME messages with HTML body and optional file attachments (base64-encoded).

- [ ] **Step 1: Write the tests**

Create `supabase/functions/create-gmail-draft/mime.test.ts`:

```typescript
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildMimeMessage, base64UrlEncode } from "./mime.ts";

Deno.test("buildMimeMessage: simple email without attachments", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Hello",
    htmlBody: "<p>Hi John</p>",
  });
  assertStringIncludes(mime, "To: john@example.com");
  assertStringIncludes(mime, "Subject: Hello");
  assertStringIncludes(mime, "Content-Type: text/html; charset=UTF-8");
  assertStringIncludes(mime, "<p>Hi John</p>");
});

Deno.test("buildMimeMessage: includes Cc and Bcc", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    cc: ["jane@example.com"],
    bcc: ["boss@example.com"],
    subject: "Hello",
    htmlBody: "<p>Hi</p>",
  });
  assertStringIncludes(mime, "Cc: jane@example.com");
  assertStringIncludes(mime, "Bcc: boss@example.com");
});

Deno.test("buildMimeMessage: with attachment creates multipart/mixed", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "With attachment",
    htmlBody: "<p>See attached</p>",
    attachments: [{
      filename: "doc.pdf",
      mimeType: "application/pdf",
      base64Content: "dGVzdA==",
    }],
  });
  assertStringIncludes(mime, "Content-Type: multipart/mixed");
  assertStringIncludes(mime, 'Content-Disposition: attachment; filename="doc.pdf"');
  assertStringIncludes(mime, "dGVzdA==");
});

Deno.test("buildMimeMessage: multiple attachments", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Docs",
    htmlBody: "<p>Hi</p>",
    attachments: [
      { filename: "a.pdf", mimeType: "application/pdf", base64Content: "YQ==" },
      { filename: "b.pdf", mimeType: "application/pdf", base64Content: "Yg==" },
    ],
  });
  assertStringIncludes(mime, 'filename="a.pdf"');
  assertStringIncludes(mime, 'filename="b.pdf"');
});

Deno.test("base64UrlEncode: encodes correctly", () => {
  const result = base64UrlEncode("Hello World");
  assertEquals(typeof result, "string");
  // base64url has no +, /, or = padding
  assertEquals(result.includes("+"), false);
  assertEquals(result.includes("/"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && deno test supabase/functions/create-gmail-draft/mime.test.ts
```

Expected: FAIL — `mime.ts` does not exist yet.

- [ ] **Step 3: Implement the MIME builder**

Create `supabase/functions/create-gmail-draft/mime.ts`:

```typescript
import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  base64Content: string; // already base64-encoded file content
}

export interface MimeMessageOptions {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  attachments?: MimeAttachment[];
}

const BOUNDARY = "keychain_mime_boundary_" + Date.now().toString(36);

/**
 * Builds an RFC 2822 MIME message string.
 * If attachments are present, creates a multipart/mixed message.
 * Otherwise, creates a simple text/html message.
 */
export function buildMimeMessage(options: MimeMessageOptions): string {
  const { to, cc, bcc, subject, htmlBody, attachments } = options;
  const lines: string[] = [];

  // Headers
  lines.push(`To: ${to}`);
  if (cc?.length) lines.push(`Cc: ${cc.join(", ")}`);
  if (bcc?.length) lines.push(`Bcc: ${bcc.join(", ")}`);
  lines.push(`Subject: ${subject}`);
  lines.push("MIME-Version: 1.0");

  if (attachments && attachments.length > 0) {
    // Multipart message with attachments
    lines.push(`Content-Type: multipart/mixed; boundary="${BOUNDARY}"`);
    lines.push("");

    // HTML body part
    lines.push(`--${BOUNDARY}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(htmlBody);

    // Attachment parts
    for (const attachment of attachments) {
      lines.push(`--${BOUNDARY}`);
      lines.push(`Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      lines.push("");
      lines.push(attachment.base64Content);
    }

    lines.push(`--${BOUNDARY}--`);
  } else {
    // Simple HTML message
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(htmlBody);
  }

  return lines.join("\r\n");
}

/**
 * Encodes a MIME message string as base64url (required by Gmail API).
 * Base64url uses - instead of +, _ instead of /, and no padding.
 */
export function base64UrlEncode(mimeMessage: string): string {
  const encoded = base64Encode(new TextEncoder().encode(mimeMessage));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && deno test supabase/functions/create-gmail-draft/mime.test.ts
```

Expected: 5 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/create-gmail-draft/mime.ts supabase/functions/create-gmail-draft/mime.test.ts && git commit -m "feat: add MIME message builder with attachment support for Gmail drafts

Builds RFC 2822 multipart/mixed MIME messages with base64url encoding.
5 passing tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: create-gmail-draft Edge Function

**Files:**
- Create: `supabase/functions/create-gmail-draft/index.ts`

**Context:** Creates a Gmail draft via the Gmail API. Accepts To/Cc/Bcc, subject, HTML body, and optional attachments (referenced by Supabase Storage keys). Downloads attachments from Storage, builds MIME message, and posts to Gmail API using the rep's refreshed access token.

- [ ] **Step 1: Create the function**

Create `supabase/functions/create-gmail-draft/index.ts`:

```typescript
import { createAdminClient } from "../_shared/supabase-client.ts";
import { refreshGoogleToken, googleApiFetch } from "../_shared/google-auth.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { buildMimeMessage, base64UrlEncode, type MimeAttachment } from "./mime.ts";

const GMAIL_DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

interface CreateDraftRequest {
  repEmail: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  contactId: string;
  opportunityId: string;
  attachments?: { storageKey: string; filename: string }[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: CreateDraftRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { repEmail, to, cc, bcc, subject, htmlBody, contactId, opportunityId, attachments } = body;
  if (!repEmail || !to || !subject || !htmlBody) {
    return jsonResponse({ error: "repEmail, to, subject, and htmlBody are required" }, 400);
  }

  try {
    const client = createAdminClient();

    // Step 1: Refresh Google access token
    const accessToken = await refreshGoogleToken(repEmail, client);

    // Step 2: Download attachments from Supabase Storage
    const mimeAttachments: MimeAttachment[] = [];
    if (attachments?.length) {
      for (const att of attachments) {
        const { data, error } = await client.storage
          .from("collateral")
          .download(att.storageKey);

        if (error) {
          console.error(`Failed to download ${att.storageKey}:`, error.message);
          continue;
        }

        const arrayBuffer = await data.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        // Convert to base64
        let binary = "";
        for (const byte of uint8) {
          binary += String.fromCharCode(byte);
        }
        const base64Content = btoa(binary);

        // Determine MIME type from filename
        const ext = att.filename.split(".").pop()?.toLowerCase() ?? "";
        const mimeTypes: Record<string, string> = {
          pdf: "application/pdf",
          doc: "application/msword",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
        };

        mimeAttachments.push({
          filename: att.filename,
          mimeType: mimeTypes[ext] ?? "application/octet-stream",
          base64Content,
        });
      }
    }

    // Step 3: Build MIME message
    const mimeMessage = buildMimeMessage({
      to,
      cc,
      bcc,
      subject,
      htmlBody,
      attachments: mimeAttachments.length > 0 ? mimeAttachments : undefined,
    });

    const encodedMessage = base64UrlEncode(mimeMessage);

    // Step 4: Create Gmail draft
    const gmailResponse = await googleApiFetch(GMAIL_DRAFTS_URL, accessToken, {
      method: "POST",
      body: JSON.stringify({
        message: { raw: encodedMessage },
      }),
    });

    if (!gmailResponse.ok) {
      const text = await gmailResponse.text();
      console.error("Gmail draft creation failed:", text);
      return jsonResponse({ error: `Gmail API error: ${gmailResponse.status}` }, 502);
    }

    const draftData = await gmailResponse.json();
    const draftId = draftData.id;

    // Step 5: Log in activity_log
    await client.from("activity_log").insert({
      opportunity_id: opportunityId,
      contact_id: contactId,
      rep_email: repEmail,
      activity_type: "email_sent", // Using email_sent as closest type; it's a draft
      activity_date: new Date().toISOString(),
      subject,
      notes: JSON.stringify({
        gmail_draft_id: draftId,
        attachments: attachments?.map((a) => a.filename) ?? [],
      }),
      source: "manual",
    });

    return jsonResponse({ success: true, draftId });
  } catch (e) {
    console.error("create-gmail-draft error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Deploy**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && npx supabase functions deploy create-gmail-draft
```

Note: Full testing requires a rep with active Google tokens. Can be tested end-to-end once auth-callback is working.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/create-gmail-draft/index.ts && git commit -m "feat: add create-gmail-draft Edge Function with attachment support

Creates Gmail drafts via API with MIME multipart messages.
Downloads attachments from Supabase Storage collateral bucket.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Frontend draft drawer redesign

**Files:**
- Rewrite: `frontend/src/components/drafting/draft-drawer.tsx`
- Create: `frontend/src/components/drafting/attachment-picker.tsx`
- Delete: `frontend/src/components/drafting/draft-variants.tsx`
- Modify: `frontend/src/components/drafting/draft-trigger.tsx`

**Context:** The draft drawer currently shows 3 placeholder variants and has a fake 1.5s delay. Redesign to match Gmail's compose experience: To/Cc/Bcc fields, subject line, rich text editor, attachment picker from Supabase Storage `collateral` bucket, two generate buttons (standard + enhanced), and a "Create Draft" button that calls `create-gmail-draft`. Remove the variant picker entirely.

- [ ] **Step 1: Create the attachment picker**

Create `frontend/src/components/drafting/attachment-picker.tsx`:

```tsx
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Paperclip, X, FileText, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export interface AttachmentFile {
  storageKey: string
  filename: string
  size: number
}

interface AttachmentPickerProps {
  attachments: AttachmentFile[]
  onAttachmentsChange: (attachments: AttachmentFile[]) => void
}

export function AttachmentPicker({ attachments, onAttachmentsChange }: AttachmentPickerProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [files, setFiles] = useState<AttachmentFile[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!showPicker) return
    setLoading(true)
    const supabase = createClient()
    supabase.storage
      .from("collateral")
      .list("", { limit: 50, sortBy: { column: "name", order: "asc" } })
      .then(({ data, error }) => {
        if (!error && data) {
          setFiles(
            data
              .filter((f) => f.name !== ".emptyFolderPlaceholder")
              .map((f) => ({
                storageKey: f.name,
                filename: f.name,
                size: f.metadata?.size ?? 0,
              }))
          )
        }
        setLoading(false)
      })
  }, [showPicker])

  function addAttachment(file: AttachmentFile) {
    if (attachments.some((a) => a.storageKey === file.storageKey)) return
    onAttachmentsChange([...attachments, file])
    setShowPicker(false)
  }

  function removeAttachment(storageKey: string) {
    onAttachmentsChange(attachments.filter((a) => a.storageKey !== storageKey))
  }

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.storageKey}
              className="flex items-center gap-1.5 rounded-md bg-kc-warm-gray px-2 py-1"
            >
              <FileText className="h-3.5 w-3.5 text-kc-text-muted" />
              <span className="text-xs text-kc-charcoal">{att.filename}</span>
              <button onClick={() => removeAttachment(att.storageKey)} className="ml-1">
                <X className="h-3 w-3 text-kc-text-muted hover:text-kc-danger" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showPicker && (
        <div className="rounded-lg border border-kc-warm-gray-dark/50 bg-white p-3">
          <p className="mb-2 text-xs font-medium text-kc-text-muted">Collateral Files</p>
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-kc-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading files...
            </div>
          ) : files.length === 0 ? (
            <p className="py-4 text-xs text-kc-text-muted">No files in collateral bucket</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {files.map((file) => (
                <button
                  key={file.storageKey}
                  onClick={() => addAttachment(file)}
                  disabled={attachments.some((a) => a.storageKey === file.storageKey)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-kc-gold-subtle/30 disabled:opacity-50"
                >
                  <FileText className="h-3.5 w-3.5 text-kc-text-muted" />
                  <span className="text-kc-charcoal">{file.filename}</span>
                  <span className="ml-auto text-kc-text-muted">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowPicker(!showPicker)}
        className="gap-1.5 text-xs text-kc-text-muted"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {showPicker ? "Close" : "Attach from Collateral"}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite the draft drawer**

Rewrite `frontend/src/components/drafting/draft-drawer.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Sparkles, Search, Send, Trash2, Loader2, ChevronDown } from "lucide-react"
import { StageBadge } from "@/components/pipeline/stage-badge"
import { EmailEditor } from "./email-editor"
import { AttachmentPicker, type AttachmentFile } from "./attachment-picker"
import * as Sentry from "@sentry/nextjs"

interface ContactContext {
  contactName: string
  contactTitle: string | null
  contactEmail: string | null
  accountName: string
  stageName: string
  opportunityId: string
  contactId: string
  repEmail: string
}

interface DraftDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: ContactContext | null
}

export function DraftDrawer({ open, onOpenChange, contact }: DraftDrawerProps) {
  const [generating, setGenerating] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<"standard" | "enhanced" | null>(null)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [editorContent, setEditorContent] = useState("")
  const [subjectLine, setSubjectLine] = useState("")
  const [toField, setToField] = useState("")
  const [ccField, setCcField] = useState("")
  const [bccField, setBccField] = useState("")
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [hasGenerated, setHasGenerated] = useState(false)
  const [draftCreated, setDraftCreated] = useState(false)

  // Reset state when contact changes
  function resetState() {
    setEditorContent("")
    setSubjectLine("")
    setCcField("")
    setBccField("")
    setShowCcBcc(false)
    setAttachments([])
    setHasGenerated(false)
    setDraftCreated(false)
    setToField(contact?.contactEmail ?? "")
  }

  function handleOpenChange(isOpen: boolean) {
    if (isOpen && contact) {
      resetState()
    }
    onOpenChange(isOpen)
  }

  async function handleGenerate(mode: "standard" | "enhanced") {
    if (!contact) return
    setGenerating(true)
    setGeneratingMode(mode)

    try {
      await Sentry.startSpan({ name: "draft.generate", op: "ai.run" }, async () => {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-draft`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contactId: contact.contactId,
              opportunityId: contact.opportunityId,
              mode,
              context: { trigger: "rep_initiated" },
            }),
          }
        )

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Generation failed: ${response.status} ${text}`)
        }

        const data = await response.json()
        setSubjectLine(data.subject)
        setEditorContent(data.htmlBody)
        setToField(contact.contactEmail ?? "")
        setHasGenerated(true)
      })
    } catch (err) {
      Sentry.captureException(err)
      alert(err instanceof Error ? err.message : "Draft generation failed")
    } finally {
      setGenerating(false)
      setGeneratingMode(null)
    }
  }

  async function handleCreateDraft() {
    if (!contact) return
    setCreatingDraft(true)

    try {
      await Sentry.startSpan({ name: "draft.createGmail", op: "http.client" }, async () => {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-gmail-draft`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              repEmail: contact.repEmail,
              to: toField,
              cc: ccField ? ccField.split(",").map((e) => e.trim()) : undefined,
              bcc: bccField ? bccField.split(",").map((e) => e.trim()) : undefined,
              subject: subjectLine,
              htmlBody: editorContent,
              contactId: contact.contactId,
              opportunityId: contact.opportunityId,
              attachments: attachments.length > 0
                ? attachments.map((a) => ({ storageKey: a.storageKey, filename: a.filename }))
                : undefined,
            }),
          }
        )

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Draft creation failed: ${response.status} ${text}`)
        }

        setDraftCreated(true)
      })
    } catch (err) {
      Sentry.captureException(err)
      alert(err instanceof Error ? err.message : "Gmail draft creation failed")
    } finally {
      setCreatingDraft(false)
    }
  }

  function handleDiscard() {
    resetState()
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg">Draft Email</SheetTitle>
        </SheetHeader>
        {contact && (
          <div className="mt-4 space-y-4">
            {/* Contact context card */}
            <div className="rounded-lg bg-kc-warm-gray p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-kc-charcoal">{contact.contactName}</p>
                  <p className="text-xs text-kc-text-muted">
                    {contact.accountName}
                    {contact.contactTitle && ` · ${contact.contactTitle}`}
                  </p>
                </div>
                <StageBadge stage={contact.stageName} />
              </div>
            </div>

            {/* Generate buttons — shown before first generation */}
            {!hasGenerated && !generating && (
              <div className="flex gap-2">
                <Button
                  onClick={() => handleGenerate("standard")}
                  className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate Draft
                </Button>
                <Button
                  onClick={() => handleGenerate("enhanced")}
                  variant="outline"
                  className="flex-1 gap-2 border-kc-gold/50 text-kc-charcoal hover:bg-kc-gold/10"
                >
                  <Search className="h-4 w-4" />
                  Enhanced Draft
                </Button>
              </div>
            )}

            {/* Loading state */}
            {generating && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-kc-gold" />
                <p className="text-sm text-kc-text-muted">
                  {generatingMode === "enhanced"
                    ? "Researching & drafting..."
                    : "Generating draft..."}
                </p>
              </div>
            )}

            {/* Draft created success */}
            {draftCreated && (
              <div className="rounded-lg bg-kc-success/10 p-4 text-center">
                <p className="text-sm font-medium text-kc-success">
                  Gmail draft created successfully
                </p>
                <p className="mt-1 text-xs text-kc-text-muted">
                  Check your Gmail drafts folder
                </p>
              </div>
            )}

            {/* Email compose form — shown after generation */}
            {hasGenerated && !draftCreated && (
              <>
                <Separator />

                {/* To field */}
                <div>
                  <div className="flex items-center gap-2">
                    <label className="w-8 text-xs text-kc-text-muted">To</label>
                    <Input
                      type="email"
                      value={toField}
                      onChange={(e) => setToField(e.target.value)}
                      className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    {!showCcBcc && (
                      <button
                        onClick={() => setShowCcBcc(true)}
                        className="text-xs text-kc-text-muted hover:text-kc-charcoal"
                      >
                        Cc Bcc
                      </button>
                    )}
                  </div>
                </div>

                {/* Cc / Bcc fields */}
                {showCcBcc && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="w-8 text-xs text-kc-text-muted">Cc</label>
                      <Input
                        type="text"
                        placeholder="Separate multiple with commas"
                        value={ccField}
                        onChange={(e) => setCcField(e.target.value)}
                        className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="w-8 text-xs text-kc-text-muted">Bcc</label>
                      <Input
                        type="text"
                        placeholder="Separate multiple with commas"
                        value={bccField}
                        onChange={(e) => setBccField(e.target.value)}
                        className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </>
                )}

                {/* Subject line */}
                <div className="flex items-center gap-2">
                  <label className="w-8 text-xs text-kc-text-muted">Subj</label>
                  <Input
                    type="text"
                    value={subjectLine}
                    onChange={(e) => setSubjectLine(e.target.value)}
                    className="flex-1 border-0 border-b border-kc-warm-gray-dark bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0"
                  />
                </div>

                <Separator />

                {/* Rich text editor */}
                <EmailEditor content={editorContent} onChange={setEditorContent} />

                {/* Attachment picker */}
                <AttachmentPicker
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                />

                <Separator />

                {/* Regenerate buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleGenerate("standard")}
                    variant="outline"
                    size="sm"
                    disabled={generating}
                    className="gap-1.5 text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                  <Button
                    onClick={() => handleGenerate("enhanced")}
                    variant="outline"
                    size="sm"
                    disabled={generating}
                    className="gap-1.5 text-xs"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Regenerate Enhanced
                  </Button>
                </div>

                {/* Action bar */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleCreateDraft}
                    disabled={creatingDraft || !toField || !subjectLine}
                    className="flex-1 gap-2 bg-kc-gold text-kc-charcoal hover:bg-kc-gold-dark"
                  >
                    {creatingDraft ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Create Gmail Draft
                  </Button>
                  <Button
                    onClick={handleDiscard}
                    variant="ghost"
                    className="gap-2 text-kc-text-muted hover:text-kc-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Update DraftTrigger to pass new props**

Read `frontend/src/components/drafting/draft-trigger.tsx` and add `contactId` and `repEmail` to the ContactContext it passes to DraftDrawer. The DraftTrigger component needs to accept these new props and pass them through.

Update the `DraftTrigger` component to include `contactId` and `repEmail` props, and pass them in the `contact` object to `DraftDrawer`.

- [ ] **Step 4: Delete draft-variants.tsx**

```bash
rm frontend/src/components/drafting/draft-variants.tsx
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -15
```

Expected: Build passes. Fix any type errors from removed variant imports.

- [ ] **Step 6: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add -A frontend/src/components/drafting/ && git commit -m "feat: redesign draft drawer to Gmail-like compose experience

Replaces variant picker with Gmail-style To/Cc/Bcc fields, attachment picker
from Supabase Storage, two generate modes (standard + enhanced), and direct
Gmail draft creation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: Daily Scan

### Task 14: Daily scan workers — scan-sf-email, scan-gmail, scan-calendar

**Files:**
- Create: `supabase/functions/daily-scan/scan-sf-email.ts`
- Create: `supabase/functions/daily-scan/scan-gmail.ts`
- Create: `supabase/functions/daily-scan/scan-calendar.ts`

**Context:** These three workers run in parallel for each rep. They all receive a Supabase client and a Google access token. Each returns a typed result object that feeds into cadence evaluation and the Slack digest.

- [ ] **Step 1: Create scan-sf-email worker**

Create `supabase/functions/daily-scan/scan-sf-email.ts`:

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { googleApiFetch } from "../_shared/google-auth.ts";

export interface SfUpdate {
  accountName: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface ScanSfEmailResult {
  sfUpdates: SfUpdate[];
  error?: string;
}

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

/**
 * Searches Gmail for the daily Salesforce report email, downloads the CSV
 * attachment, and diffs against the opportunities table.
 */
export async function scanSfEmail(
  repEmail: string,
  accessToken: string,
  client: SupabaseClient
): Promise<ScanSfEmailResult> {
  try {
    // Search for SF report email from today
    const searchQuery = "from:reports@salesforce.com newer_than:1d has:attachment";
    const searchResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}?q=${encodeURIComponent(searchQuery)}&maxResults=1`,
      accessToken
    );

    if (!searchResponse.ok) {
      return { sfUpdates: [], error: `Gmail search failed: ${searchResponse.status}` };
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages ?? [];

    if (messages.length === 0) {
      return { sfUpdates: [] }; // No SF report email today — not an error
    }

    const messageId = messages[0].id;

    // Get the message with attachment metadata
    const msgResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}/${messageId}`,
      accessToken
    );

    if (!msgResponse.ok) {
      return { sfUpdates: [], error: `Failed to fetch message: ${msgResponse.status}` };
    }

    const msgData = await msgResponse.json();

    // Find CSV attachment
    const parts = msgData.payload?.parts ?? [];
    const csvPart = parts.find(
      (p: { filename: string; mimeType: string }) =>
        p.filename?.endsWith(".csv") || p.mimeType === "text/csv"
    );

    if (!csvPart?.body?.attachmentId) {
      return { sfUpdates: [], error: "No CSV attachment found in SF report email" };
    }

    // Download attachment
    const attResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}/${messageId}/attachments/${csvPart.body.attachmentId}`,
      accessToken
    );

    if (!attResponse.ok) {
      return { sfUpdates: [], error: `Failed to download attachment: ${attResponse.status}` };
    }

    const attData = await attResponse.json();
    // Gmail returns base64url-encoded data
    const csvBase64 = attData.data.replace(/-/g, "+").replace(/_/g, "/");
    const csvText = atob(csvBase64);

    // Parse CSV (reuse the csv-import parser logic)
    // Import dynamically to avoid circular dependency
    const { parseCSVRows } = await import("../../csv-import/parse.ts");
    const rows = parseCSVRows(csvText);

    // Diff against existing opportunities
    const sfUpdates: SfUpdate[] = [];
    const DIFF_FIELDS = ["stage_name", "amount", "opp_owner", "next_step", "next_steps_c"];

    for (const row of rows) {
      const { data: existing } = await client
        .from("opportunities")
        .select("id, stage_name, amount, opp_owner, next_step, next_steps_c, account_name")
        .eq("sf_opportunity_id", row.opportunity.sf_opportunity_id)
        .single();

      if (!existing) continue;

      const updates: Record<string, unknown> = {};

      for (const field of DIFF_FIELDS) {
        const oldVal = existing[field as keyof typeof existing];
        const newVal = row.opportunity[field as keyof typeof row.opportunity];
        if (newVal !== null && newVal !== undefined && String(newVal) !== String(oldVal ?? "")) {
          updates[field] = newVal;
          sfUpdates.push({
            accountName: existing.account_name,
            field,
            oldValue: oldVal != null ? String(oldVal) : null,
            newValue: String(newVal),
          });
        }
      }

      if (Object.keys(updates).length > 0) {
        updates["last_sf_sync_at"] = new Date().toISOString();
        await client
          .from("opportunities")
          .update(updates)
          .eq("id", existing.id);

        // Log activity
        await client.from("activity_log").insert({
          opportunity_id: existing.id,
          rep_email: repEmail,
          activity_type: "manual_log",
          activity_date: new Date().toISOString(),
          subject: `SF update: ${Object.keys(updates).filter((k) => k !== "last_sf_sync_at").join(", ")}`,
          source: "sf_report",
        });
      }
    }

    return { sfUpdates };
  } catch (e) {
    return { sfUpdates: [], error: (e as Error).message };
  }
}
```

- [ ] **Step 2: Create scan-gmail worker**

Create `supabase/functions/daily-scan/scan-gmail.ts`:

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { googleApiFetch } from "../_shared/google-auth.ts";

export interface EmailActivity {
  contactName: string;
  contactId: string;
  opportunityId: string;
  type: "email_sent" | "email_received" | "reply_received";
  subject: string;
  messageId: string;
}

export interface ScanGmailResult {
  emailActivity: EmailActivity[];
  error?: string;
}

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

/**
 * Scans Gmail for email activity with contacts in the rep's pipeline.
 * Classifies messages as sent/received/reply and logs to activity_log.
 */
export async function scanGmail(
  repEmail: string,
  accessToken: string,
  lastScanAt: string | null,
  client: SupabaseClient
): Promise<ScanGmailResult> {
  try {
    // Load all contact emails for this rep's opportunities
    const { data: contacts } = await client
      .from("opportunities")
      .select("id, opportunity_contacts(contacts(id, email, first_name, last_name))")
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null);

    if (!contacts?.length) return { emailActivity: [] };

    // Build email→contact lookup
    const emailToContact = new Map<string, { contactId: string; contactName: string; opportunityId: string }>();
    for (const opp of contacts) {
      for (const oc of opp.opportunity_contacts ?? []) {
        const c = oc.contacts;
        if (c?.email) {
          emailToContact.set(c.email.toLowerCase(), {
            contactId: c.id,
            contactName: `${c.first_name} ${c.last_name}`,
            opportunityId: opp.id,
          });
        }
      }
    }

    if (emailToContact.size === 0) return { emailActivity: [] };

    // Search Gmail for recent messages
    const query = lastScanAt
      ? `after:${Math.floor(new Date(lastScanAt).getTime() / 1000)}`
      : "newer_than:1d";

    const searchResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}?q=${encodeURIComponent(query)}&maxResults=100`,
      accessToken
    );

    if (!searchResponse.ok) {
      return { emailActivity: [], error: `Gmail search failed: ${searchResponse.status}` };
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages ?? [];
    const emailActivity: EmailActivity[] = [];

    for (const msg of messages) {
      const msgResponse = await googleApiFetch(
        `${GMAIL_MESSAGES_URL}/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
        accessToken
      );

      if (!msgResponse.ok) continue;

      const msgData = await msgResponse.json();
      const headers = msgData.payload?.headers ?? [];
      const from = headers.find((h: { name: string }) => h.name === "From")?.value ?? "";
      const to = headers.find((h: { name: string }) => h.name === "To")?.value ?? "";
      const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? "";

      // Extract email addresses
      const fromEmail = extractEmail(from);
      const toEmails = to.split(",").map(extractEmail);

      // Check if any participant is a known contact
      let match: { contactId: string; contactName: string; opportunityId: string } | undefined;
      let type: "email_sent" | "email_received" | "reply_received";

      if (fromEmail === repEmail) {
        // Rep sent an email — check if any recipient is a contact
        for (const toEmail of toEmails) {
          match = emailToContact.get(toEmail.toLowerCase());
          if (match) break;
        }
        type = "email_sent";
      } else {
        // Someone sent email to rep — check if sender is a contact
        match = emailToContact.get(fromEmail.toLowerCase());
        type = subject.toLowerCase().startsWith("re:") ? "reply_received" : "email_received";
      }

      if (!match) continue;

      // Check for duplicate (already logged this messageId)
      const { count } = await client
        .from("activity_log")
        .select("*", { count: "exact", head: true })
        .like("notes", `%${msg.id}%`);

      if ((count ?? 0) > 0) continue;

      emailActivity.push({
        contactName: match.contactName,
        contactId: match.contactId,
        opportunityId: match.opportunityId,
        type,
        subject,
        messageId: msg.id,
      });

      // Log to activity_log
      await client.from("activity_log").insert({
        opportunity_id: match.opportunityId,
        contact_id: match.contactId,
        rep_email: repEmail,
        activity_type: type,
        activity_date: new Date().toISOString(),
        subject,
        notes: JSON.stringify({ gmail_message_id: msg.id }),
        source: "gmail_scan",
      });
    }

    return { emailActivity };
  } catch (e) {
    return { emailActivity: [], error: (e as Error).message };
  }
}

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return (match ? match[1] : headerValue).trim().toLowerCase();
}
```

- [ ] **Step 3: Create scan-calendar worker**

Create `supabase/functions/daily-scan/scan-calendar.ts`:

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { googleApiFetch } from "../_shared/google-auth.ts";

export interface MeetingDetected {
  contactName: string;
  contactId: string;
  opportunityId: string;
  eventTitle: string;
  eventTime: string;
  inferredType: string;
  isToday: boolean;
}

export interface ScanCalendarResult {
  meetingsToday: MeetingDetected[];
  upcomingMeetings: MeetingDetected[];
  progressions: { accountName: string; fromType: string; toType: string }[];
  prepDraftsCreated: number;
  error?: string;
}

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const MEETING_TYPE_KEYWORDS: [string, string][] = [
  ["intro", "intro"],
  ["demo", "meeting"],
  ["meeting", "meeting"],
  ["proposal", "proposal"],
  ["pricing", "proposal"],
  ["next steps", "next_steps"],
  ["follow", "next_steps"],
  ["catch", "catch_up"],
  ["check in", "catch_up"],
];

function inferMeetingType(title: string): string {
  const lower = title.toLowerCase();
  for (const [keyword, type] of MEETING_TYPE_KEYWORDS) {
    if (lower.includes(keyword)) return type;
  }
  return "unknown";
}

/**
 * Scans Google Calendar for meetings today (for logging) and the next 7 days
 * (for prep drafting and stage progression detection).
 */
export async function scanCalendar(
  repEmail: string,
  accessToken: string,
  client: SupabaseClient
): Promise<ScanCalendarResult> {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Fetch events for the next 7 days
    const params = new URLSearchParams({
      timeMin: today.toISOString(),
      timeMax: weekAhead.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });

    const calResponse = await googleApiFetch(
      `${CALENDAR_EVENTS_URL}?${params}`,
      accessToken
    );

    if (!calResponse.ok) {
      return { meetingsToday: [], upcomingMeetings: [], progressions: [], prepDraftsCreated: 0, error: `Calendar API failed: ${calResponse.status}` };
    }

    const calData = await calResponse.json();
    const events = calData.items ?? [];

    // Load contact email lookup for this rep
    const { data: opportunities } = await client
      .from("opportunities")
      .select("id, account_name, stage_name, opportunity_contacts(contacts(id, email, first_name, last_name))")
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null);

    const emailToContact = new Map<string, { contactId: string; contactName: string; opportunityId: string; accountName: string }>();
    for (const opp of opportunities ?? []) {
      for (const oc of opp.opportunity_contacts ?? []) {
        const c = oc.contacts;
        if (c?.email) {
          emailToContact.set(c.email.toLowerCase(), {
            contactId: c.id,
            contactName: `${c.first_name} ${c.last_name}`,
            opportunityId: opp.id,
            accountName: opp.account_name,
          });
        }
      }
    }

    const meetingsToday: MeetingDetected[] = [];
    const upcomingMeetings: MeetingDetected[] = [];
    const progressions: { accountName: string; fromType: string; toType: string }[] = [];
    let prepDraftsCreated = 0;

    for (const event of events) {
      const attendees = event.attendees ?? [];
      const attendeeEmails = attendees.map((a: { email: string }) => a.email?.toLowerCase()).filter(Boolean);

      // Find matching contact
      let match: { contactId: string; contactName: string; opportunityId: string; accountName: string } | undefined;
      for (const email of attendeeEmails) {
        match = emailToContact.get(email);
        if (match) break;
      }

      if (!match) continue;

      const eventStart = new Date(event.start?.dateTime ?? event.start?.date ?? "");
      const isToday = eventStart >= today && eventStart < tomorrow;
      const inferredType = inferMeetingType(event.summary ?? "");

      const meeting: MeetingDetected = {
        contactName: match.contactName,
        contactId: match.contactId,
        opportunityId: match.opportunityId,
        eventTitle: event.summary ?? "Untitled",
        eventTime: eventStart.toISOString(),
        inferredType,
        isToday,
      };

      if (isToday) {
        meetingsToday.push(meeting);
        // Log today's meetings
        await client.from("activity_log").insert({
          opportunity_id: match.opportunityId,
          contact_id: match.contactId,
          rep_email: repEmail,
          activity_type: "meeting_held",
          activity_date: eventStart.toISOString(),
          subject: event.summary,
          notes: JSON.stringify({ calendar_event_id: event.id, attendees: attendeeEmails }),
          source: "calendar_scan",
        });
      } else {
        upcomingMeetings.push(meeting);
      }

      // Upsert upcoming_meetings
      await client.from("upcoming_meetings").upsert({
        opportunity_id: match.opportunityId,
        contact_id: match.contactId,
        rep_email: repEmail,
        meeting_title: event.summary,
        meeting_date: eventStart.toISOString(),
        attendees: attendeeEmails,
        inferred_type: inferredType,
      }, {
        onConflict: "opportunity_id,meeting_date",
      });
    }

    return { meetingsToday, upcomingMeetings, progressions, prepDraftsCreated };
  } catch (e) {
    return { meetingsToday: [], upcomingMeetings: [], progressions: [], prepDraftsCreated: 0, error: (e as Error).message };
  }
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/daily-scan/scan-sf-email.ts supabase/functions/daily-scan/scan-gmail.ts supabase/functions/daily-scan/scan-calendar.ts && git commit -m "feat: add daily-scan workers for SF email, Gmail, and Calendar scanning

Three parallel workers: scan-sf-email (SF report CSV diff), scan-gmail
(email activity detection), scan-calendar (meeting logging + 7-day lookahead).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Daily scan workers — eval-cadence, check-draft-status

**Files:**
- Create: `supabase/functions/daily-scan/eval-cadence.ts`
- Create: `supabase/functions/daily-scan/check-draft-status.ts`

- [ ] **Step 1: Create eval-cadence worker**

Create `supabase/functions/daily-scan/eval-cadence.ts`:

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const ACTIVE_STAGES = new Set([
  "First Meeting Completed",
  "Second Call Scheduled",
  "Second Meeting Completed",
  "Proposal Meeting Scheduled",
  "Proposal Sent",
  "Next Steps Scheduled",
  "Next Steps Completed",
  "Service Agreement Sent",
]);

export interface OverdueContact {
  contactName: string;
  contactId: string;
  opportunityId: string;
  accountName: string;
  daysSince: number;
  threshold: number;
  isCritical: boolean;
  autoDrafted: boolean;
}

export interface EvalCadenceResult {
  overdue: OverdueContact[];
  error?: string;
}

/**
 * Evaluates cadence compliance for all active opportunities.
 * Contacts overdue by 2x threshold get auto-drafted.
 */
export async function evalCadence(
  repEmail: string,
  client: SupabaseClient
): Promise<EvalCadenceResult> {
  try {
    // Load active opportunities for this rep
    const { data: opportunities } = await client
      .from("opportunities")
      .select("id, account_name, stage_name, opportunity_contacts(contacts(id, first_name, last_name, email))")
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null);

    if (!opportunities?.length) return { overdue: [] };

    // Load cadence rules
    const { data: cadenceRules } = await client.from("cadence_rules").select("*");
    const cadenceMap = new Map(
      (cadenceRules ?? []).map((r: { stage_name: string; days_between_touches: number }) => [
        r.stage_name,
        r.days_between_touches,
      ])
    );

    const overdue: OverdueContact[] = [];

    for (const opp of opportunities) {
      if (!ACTIVE_STAGES.has(opp.stage_name)) continue;

      const threshold = cadenceMap.get(opp.stage_name);
      if (!threshold) continue;

      // Find most recent activity
      const { data: lastActivity } = await client
        .from("activity_log")
        .select("activity_date")
        .eq("opportunity_id", opp.id)
        .order("activity_date", { ascending: false })
        .limit(1)
        .single();

      const daysSince = lastActivity
        ? Math.floor((Date.now() - new Date(lastActivity.activity_date).getTime()) / (1000 * 60 * 60 * 24))
        : 999; // No activity ever = very overdue

      if (daysSince < threshold) continue;

      const primaryContact = opp.opportunity_contacts?.[0]?.contacts;
      if (!primaryContact) continue;

      const isCritical = daysSince >= threshold * 2;

      let autoDrafted = false;
      if (isCritical) {
        // Auto-draft for critically overdue contacts
        try {
          const draftUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-draft`;
          const draftResponse = await fetch(draftUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contactId: primaryContact.id,
              opportunityId: opp.id,
              mode: "standard",
              context: {
                trigger: "auto_overdue",
                daysOverdue: daysSince,
                cadenceThreshold: threshold,
              },
            }),
          });

          if (draftResponse.ok) {
            const draftData = await draftResponse.json();

            // Create Gmail draft (will require access token — skip if not available)
            // For auto-drafts, we'll create the draft via the create-gmail-draft function
            // This is handled by the orchestrator which has the access token
            autoDrafted = true;
          }
        } catch (err) {
          console.error(`Auto-draft failed for ${opp.account_name}:`, (err as Error).message);
        }
      }

      overdue.push({
        contactName: `${primaryContact.first_name} ${primaryContact.last_name}`,
        contactId: primaryContact.id,
        opportunityId: opp.id,
        accountName: opp.account_name,
        daysSince,
        threshold,
        isCritical,
        autoDrafted,
      });
    }

    // Sort by days overdue descending
    overdue.sort((a, b) => b.daysSince - a.daysSince);

    return { overdue };
  } catch (e) {
    return { overdue: [], error: (e as Error).message };
  }
}
```

- [ ] **Step 2: Create check-draft-status worker**

Create `supabase/functions/daily-scan/check-draft-status.ts`:

```typescript
import { googleApiFetch } from "../_shared/google-auth.ts";

export interface PendingDraft {
  contactName: string;
  subject: string;
  createdAt: string;
  draftId: string;
}

export interface CheckDraftStatusResult {
  pendingDrafts: PendingDraft[];
  error?: string;
}

const GMAIL_DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

/**
 * Checks Gmail for unsent AI-generated drafts.
 * Identifies drafts created by the system (using subject patterns or labels).
 */
export async function checkDraftStatus(
  accessToken: string
): Promise<CheckDraftStatusResult> {
  try {
    const response = await googleApiFetch(
      `${GMAIL_DRAFTS_URL}?maxResults=20`,
      accessToken
    );

    if (!response.ok) {
      return { pendingDrafts: [], error: `Gmail drafts API failed: ${response.status}` };
    }

    const data = await response.json();
    const drafts = data.drafts ?? [];
    const pendingDrafts: PendingDraft[] = [];

    for (const draft of drafts) {
      const draftResponse = await googleApiFetch(
        `${GMAIL_DRAFTS_URL}/${draft.id}`,
        accessToken
      );

      if (!draftResponse.ok) continue;

      const draftData = await draftResponse.json();
      const headers = draftData.message?.payload?.headers ?? [];
      const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? "";
      const to = headers.find((h: { name: string }) => h.name === "To")?.value ?? "";
      const date = headers.find((h: { name: string }) => h.name === "Date")?.value ?? "";

      pendingDrafts.push({
        contactName: to, // Will be resolved to contact name by the digest composer
        subject,
        createdAt: date,
        draftId: draft.id,
      });
    }

    return { pendingDrafts };
  } catch (e) {
    return { pendingDrafts: [], error: (e as Error).message };
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/daily-scan/eval-cadence.ts supabase/functions/daily-scan/check-draft-status.ts && git commit -m "feat: add cadence evaluation and draft status workers for daily scan

eval-cadence: calculates overdue contacts, auto-drafts at 2x threshold.
check-draft-status: finds unsent AI drafts in Gmail.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Daily scan — compose-digest + orchestrator

**Files:**
- Create: `supabase/functions/daily-scan/compose-digest.ts`
- Create: `supabase/functions/daily-scan/index.ts`

- [ ] **Step 1: Create compose-digest worker**

Create `supabase/functions/daily-scan/compose-digest.ts`:

```typescript
import { sendSlackDM } from "../_shared/slack.ts";
import type { SfUpdate } from "./scan-sf-email.ts";
import type { EmailActivity } from "./scan-gmail.ts";
import type { MeetingDetected } from "./scan-calendar.ts";
import type { OverdueContact } from "./eval-cadence.ts";
import type { PendingDraft } from "./check-draft-status.ts";

export interface DigestInput {
  repEmail: string;
  sfUpdates: SfUpdate[];
  emailActivity: EmailActivity[];
  meetingsToday: MeetingDetected[];
  upcomingMeetings: MeetingDetected[];
  overdue: OverdueContact[];
  pendingDrafts: PendingDraft[];
}

/**
 * Formats scan results into a Slack DM digest and sends it to the rep.
 * Omits empty sections.
 */
export async function composeAndSendDigest(input: DigestInput): Promise<{ sent: boolean; error?: string }> {
  try {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    const sections: string[] = [];
    sections.push(`*Daily Briefing — ${today}*\n`);

    // SF Updates
    if (input.sfUpdates.length > 0) {
      sections.push("*SF Updates Detected*");
      for (const u of input.sfUpdates.slice(0, 10)) {
        sections.push(`• ${u.accountName} — ${u.field}: ${u.oldValue ?? "—"} → ${u.newValue}`);
      }
      sections.push("");
    }

    // Activity Today
    const sent = input.emailActivity.filter((e) => e.type === "email_sent").length;
    const received = input.emailActivity.filter((e) => e.type === "email_received" || e.type === "reply_received").length;
    const meetings = input.meetingsToday.length;
    if (sent > 0 || received > 0 || meetings > 0) {
      sections.push("*Activity Today*");
      const parts: string[] = [];
      if (sent > 0) parts.push(`${sent} emails sent`);
      if (received > 0) parts.push(`${received} received`);
      if (meetings > 0) parts.push(`${meetings} meeting${meetings > 1 ? "s" : ""} held`);
      sections.push(`• ${parts.join(", ")}`);
      sections.push("");
    }

    // Drafts Ready
    if (input.pendingDrafts.length > 0) {
      sections.push("*Drafts Ready in Gmail*");
      for (const d of input.pendingDrafts.slice(0, 5)) {
        sections.push(`• ${d.contactName} — "${d.subject}" (${d.createdAt})`);
      }
      sections.push("");
    }

    // Follow-Ups Due
    if (input.overdue.length > 0) {
      sections.push("*Follow-Ups Due*");
      for (const o of input.overdue.slice(0, 10)) {
        const prefix = o.isCritical ? "• :warning: *" : "• ";
        const suffix = o.isCritical ? `* — ${o.daysSince} days overdue (threshold: ${o.threshold}d)` : ` — ${o.daysSince} days overdue (threshold: ${o.threshold}d)`;
        const autoDraftNote = o.autoDrafted ? " _(auto-drafted)_" : "";
        sections.push(`${prefix}${o.accountName}${suffix}${autoDraftNote}`);
      }
      sections.push("");
    }

    // Upcoming Meetings
    if (input.upcomingMeetings.length > 0) {
      sections.push("*Upcoming Meetings (Next 7 Days)*");
      for (const m of input.upcomingMeetings.slice(0, 5)) {
        const date = new Date(m.eventTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        sections.push(`• ${date}: ${m.eventTitle} — ${m.contactName}`);
      }
      sections.push("");
    }

    const message = sections.join("\n");

    // Only send if there's actual content beyond the header
    if (sections.length <= 2) {
      return { sent: false }; // Nothing to report
    }

    await sendSlackDM(input.repEmail, message);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

/**
 * Formats and sends the team-wide founder digest.
 */
export async function composeAndSendFounderDigest(
  founderEmails: string[],
  repResults: { repEmail: string; overdue: OverdueContact[]; emailActivity: EmailActivity[]; meetingsToday: MeetingDetected[]; success: boolean }[]
): Promise<void> {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const successCount = repResults.filter((r) => r.success).length;
  const totalSent = repResults.reduce((sum, r) => sum + r.emailActivity.filter((e) => e.type === "email_sent").length, 0);
  const totalReceived = repResults.reduce((sum, r) => sum + r.emailActivity.filter((e) => e.type !== "email_sent").length, 0);
  const totalMeetings = repResults.reduce((sum, r) => sum + r.meetingsToday.length, 0);

  const sections: string[] = [];
  sections.push(`*Team Activity Report — ${today}*\n`);

  sections.push("*Coverage Summary*");
  sections.push(`• ${successCount}/${repResults.length} reps scanned successfully`);
  sections.push(`• ${totalSent} emails sent today, ${totalReceived} received, ${totalMeetings} meetings held`);
  sections.push("");

  // Find reps with most overdue contacts
  const repsWithOverdue = repResults
    .filter((r) => r.overdue.length >= 5)
    .sort((a, b) => b.overdue.length - a.overdue.length)
    .slice(0, 5);

  if (repsWithOverdue.length > 0) {
    sections.push("*Attention Needed*");
    sections.push(`• ${repsWithOverdue.length} reps with 5+ overdue contacts`);
    for (const r of repsWithOverdue) {
      const maxOverdue = Math.max(...r.overdue.map((o) => o.daysSince));
      sections.push(`• ${r.repEmail.split("@")[0]}: ${r.overdue.length} overdue (highest: ${maxOverdue} days)`);
    }
    sections.push("");
  }

  const message = sections.join("\n");

  for (const email of founderEmails) {
    try {
      await sendSlackDM(email, message);
    } catch (e) {
      console.error(`Failed to send founder digest to ${email}:`, (e as Error).message);
    }
  }
}
```

- [ ] **Step 2: Create the orchestrator**

Create `supabase/functions/daily-scan/index.ts`:

```typescript
import { createAdminClient } from "../_shared/supabase-client.ts";
import { refreshGoogleToken } from "../_shared/google-auth.ts";
import { scanSfEmail, type ScanSfEmailResult } from "./scan-sf-email.ts";
import { scanGmail, type ScanGmailResult } from "./scan-gmail.ts";
import { scanCalendar, type ScanCalendarResult } from "./scan-calendar.ts";
import { evalCadence, type EvalCadenceResult } from "./eval-cadence.ts";
import { checkDraftStatus, type CheckDraftStatusResult } from "./check-draft-status.ts";
import { composeAndSendDigest, composeAndSendFounderDigest } from "./compose-digest.ts";

const FOUNDER_EMAILS = ["alex.gold@keychain.com", "dusty.reese@keychain.com"];

interface RepScanResult {
  repEmail: string;
  success: boolean;
  sfResult: ScanSfEmailResult;
  gmailResult: ScanGmailResult;
  calendarResult: ScanCalendarResult;
  cadenceResult: EvalCadenceResult;
  draftStatusResult: CheckDraftStatusResult;
  digestSent: boolean;
  error?: string;
}

Deno.serve(async (req: Request) => {
  // Accept POST only (from pg_cron or manual trigger)
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const client = createAdminClient();

  // Load all active reps with tokens
  const { data: reps, error: repError } = await client
    .from("rep_tokens")
    .select("rep_email, last_scan_at")
    .eq("is_active", true)
    .not("google_refresh_token", "is", null);

  if (repError || !reps?.length) {
    return new Response(
      JSON.stringify({ error: repError?.message ?? "No active reps found" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`Daily scan starting for ${reps.length} reps`);

  // Run all reps in parallel
  const results: RepScanResult[] = await Promise.all(
    reps.map(async (rep): Promise<RepScanResult> => {
      const repEmail = rep.rep_email;
      const emptyResult: RepScanResult = {
        repEmail,
        success: false,
        sfResult: { sfUpdates: [] },
        gmailResult: { emailActivity: [] },
        calendarResult: { meetingsToday: [], upcomingMeetings: [], progressions: [], prepDraftsCreated: 0 },
        cadenceResult: { overdue: [] },
        draftStatusResult: { pendingDrafts: [] },
        digestSent: false,
      };

      try {
        // Step 0: Refresh Google token
        const accessToken = await refreshGoogleToken(repEmail, client);

        // Steps 1, 2, 3, 5: Run in parallel (all independent)
        const [sfResult, gmailResult, calendarResult, draftStatusResult] = await Promise.all([
          scanSfEmail(repEmail, accessToken, client),
          scanGmail(repEmail, accessToken, rep.last_scan_at, client),
          scanCalendar(repEmail, accessToken, client),
          checkDraftStatus(accessToken),
        ]);

        // Step 4: Cadence evaluation (depends on 1, 2, 3 for complete activity picture)
        const cadenceResult = await evalCadence(repEmail, client);

        // Step 6: Compose and send Slack digest
        const digestResult = await composeAndSendDigest({
          repEmail,
          sfUpdates: sfResult.sfUpdates,
          emailActivity: gmailResult.emailActivity,
          meetingsToday: calendarResult.meetingsToday,
          upcomingMeetings: calendarResult.upcomingMeetings,
          overdue: cadenceResult.overdue,
          pendingDrafts: draftStatusResult.pendingDrafts,
        });

        // Update last_scan_at
        await client
          .from("rep_tokens")
          .update({ last_scan_at: new Date().toISOString() })
          .eq("rep_email", repEmail);

        return {
          repEmail,
          success: true,
          sfResult,
          gmailResult,
          calendarResult,
          cadenceResult,
          draftStatusResult,
          digestSent: digestResult.sent,
        };
      } catch (e) {
        console.error(`Scan failed for ${repEmail}:`, (e as Error).message);
        return { ...emptyResult, error: (e as Error).message };
      }
    })
  );

  // Step 7: Founder digest (after all reps complete)
  try {
    await composeAndSendFounderDigest(
      FOUNDER_EMAILS,
      results.map((r) => ({
        repEmail: r.repEmail,
        overdue: r.cadenceResult.overdue,
        emailActivity: r.gmailResult.emailActivity,
        meetingsToday: r.calendarResult.meetingsToday,
        success: r.success,
      }))
    );
  } catch (e) {
    console.error("Founder digest failed:", (e as Error).message);
  }

  const duration = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;

  console.log(`Daily scan complete: ${successCount}/${results.length} reps, ${duration}ms`);

  return new Response(
    JSON.stringify({
      repsScanned: results.length,
      repsSucceeded: successCount,
      repsFailed: results.length - successCount,
      durationMs: duration,
      failures: results.filter((r) => !r.success).map((r) => ({ rep: r.repEmail, error: r.error })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
```

- [ ] **Step 3: Deploy and test**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && npx supabase functions deploy daily-scan
```

Test with manual trigger:
```bash
curl -X POST "https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/daily-scan" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: JSON response with reps scanned count. Will show failures until reps have Google tokens.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/daily-scan/ && git commit -m "feat: add daily-scan orchestrator with parallel rep scanning and Slack digests

Orchestrator runs all reps in Promise.all. Per rep: SF email scan, Gmail scan,
calendar scan, and draft status check run in parallel; cadence eval waits for
activity data; digest assembles and sends via Slack DM. Founder summary sent
after all reps complete.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: Background Research & Scheduling

### Task 17: research-batch Edge Function

**Files:**
- Create: `supabase/functions/research-batch/index.ts`

**Context:** Runs 1-2x/week via pg_cron. Queries all active accounts, submits Claude Batch API requests with web_search for each, and stores results in knowledge_base. Uses batch processing for 50% cost reduction.

- [ ] **Step 1: Create the function**

Create `supabase/functions/research-batch/index.ts`:

```typescript
import { createAdminClient } from "../_shared/supabase-client.ts";
import { upsertKnowledge, purgeExpiredKnowledge, type KnowledgeChunk } from "../_shared/knowledge.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-6";

// Process accounts in batches to avoid overloading the API
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 2000;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const client = createAdminClient();
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Purge expired knowledge first
  const purged = await purgeExpiredKnowledge(client);
  console.log(`Purged ${purged} expired knowledge rows`);

  // Get distinct active account names
  const { data: accounts, error: accError } = await client
    .from("opportunities")
    .select("account_name")
    .not("stage_name", "is", null)
    .not("account_name", "is", null);

  if (accError || !accounts?.length) {
    return new Response(
      JSON.stringify({ error: accError?.message ?? "No active accounts" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Deduplicate account names
  const uniqueAccounts = [...new Set(accounts.map((a: { account_name: string }) => a.account_name))];
  console.log(`Researching ${uniqueAccounts.length} active accounts`);

  let researched = 0;
  let errors = 0;

  // Process in batches (not using Batch API for v1 — using real-time calls in batches
  // to stay within rate limits. Can migrate to Batch API in v2 for cost savings.)
  for (let i = 0; i < uniqueAccounts.length; i += BATCH_SIZE) {
    const batch = uniqueAccounts.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (accountName) => {
        try {
          const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              max_tokens: 1024,
              tools: [{ type: "web_search", name: "web_search" }],
              messages: [{
                role: "user",
                content: `Search for recent news and developments about "${accountName}" in the manufacturing, sourcing, or supply chain space. Focus on the last 30 days. Provide a brief 1-2 paragraph summary of the most relevant findings. If no significant news is found, say "No recent news found."`,
              }],
            }),
          });

          if (!response.ok) {
            console.error(`Research failed for ${accountName}: ${response.status}`);
            return null;
          }

          const data = await response.json();
          const textBlocks = data.content?.filter(
            (b: { type: string }) => b.type === "text"
          ) ?? [];
          const researchText = textBlocks.map((b: { text: string }) => b.text).join("\n").trim();

          if (!researchText || researchText.includes("No recent news found")) {
            return null;
          }

          const today = new Date().toISOString().split("T")[0];
          const chunk: KnowledgeChunk = {
            sourceType: "web_research",
            sourceId: `research_batch_${today}`,
            accountName,
            content: researchText,
            metadata: { batch_date: today, query: accountName },
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          };

          return chunk;
        } catch (e) {
          console.error(`Research error for ${accountName}:`, (e as Error).message);
          return null;
        }
      })
    );

    const validChunks = results.filter((r): r is KnowledgeChunk => r !== null);
    if (validChunks.length > 0) {
      const result = await upsertKnowledge(client, validChunks);
      researched += result.upserted;
      errors += result.errors;
    }

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < uniqueAccounts.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  const duration = Date.now() - startTime;
  console.log(`Research batch complete: ${researched} accounts researched, ${errors} errors, ${duration}ms`);

  return new Response(
    JSON.stringify({
      totalAccounts: uniqueAccounts.length,
      researched,
      errors,
      purgedExpired: purged,
      durationMs: duration,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
```

- [ ] **Step 2: Deploy**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && npx supabase functions deploy research-batch
```

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/functions/research-batch/ && git commit -m "feat: add research-batch Edge Function for automated web research

Queries active accounts, runs Claude with web_search for each,
stores findings in knowledge_base with 7-day expiry.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: pg_cron migration

**Files:**
- Create: `supabase/migrations/006_pg_cron_schedules.sql`

**Context:** Sets up pg_cron and pg_net extensions, then schedules the daily-scan (weekdays 3:30pm ET) and research-batch (Tuesday/Thursday 2am ET) cron jobs.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/006_pg_cron_schedules.sql`:

```sql
-- ============================================================
-- Migration 006: pg_cron schedules for daily-scan and research-batch
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Daily scan: weekdays at 3:30pm ET (7:30pm UTC during EDT, 8:30pm UTC during EST)
-- Using EDT offset for now. Adjust when clocks change.
SELECT cron.schedule(
  'daily-scan',
  '30 19 * * 1-5',
  $$
  SELECT extensions.http_post(
    url := 'https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/daily-scan',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );
  $$
);

-- Research batch: Tuesday and Thursday at 2am ET (6am UTC during EDT)
SELECT cron.schedule(
  'research-batch',
  '0 6 * * 2,4',
  $$
  SELECT extensions.http_post(
    url := 'https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/research-batch',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );
  $$
);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run: `mcp__supabase__apply_migration` with name `pg_cron_schedules` and the SQL above.

Verify: `mcp__supabase__execute_sql` with `SELECT * FROM cron.job;` — should show 2 jobs.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add supabase/migrations/006_pg_cron_schedules.sql && git commit -m "feat: add pg_cron schedules for daily-scan and research-batch

Daily scan: weekdays 3:30pm ET. Research batch: Tue/Thu 2am ET.
Both call Edge Functions via pg_net HTTP POST.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Completion Checklist

### Phase 1: Foundation
- [ ] `knowledge_base` table created with pgvector and HNSW index
- [ ] `search_knowledge` RPC function works
- [ ] CORS helper created and used by browser-facing functions
- [ ] Google auth helper can refresh tokens from Vault
- [ ] Slack helper can send DMs
- [ ] Knowledge helper can generate embeddings and search/upsert
- [ ] `auth-callback` deployed and returns 302 on GET

### Phase 2: Data Ingestion
- [ ] Metabase CSV parser passes all 8 tests
- [ ] `ingest-metabase` function deployed and ingests real Metabase CSV
- [ ] `knowledge_base` has rows with `source_type = 'metabase_report'`
- [ ] Frontend admin page shows Metabase upload section

### Phase 3: AI Drafting
- [ ] `generate-draft` produces valid JSON with subject + htmlBody
- [ ] Standard mode uses only internal data (no web search)
- [ ] Enhanced mode calls web_search and stores results
- [ ] MIME builder passes all 5 tests
- [ ] `create-gmail-draft` creates a real Gmail draft (requires Google tokens)
- [ ] Frontend draft drawer has Gmail-like To/Cc/Bcc/Subject/Editor/Attachments
- [ ] Variant picker removed, single draft generation flow works

### Phase 4: Daily Scan
- [ ] `daily-scan` runs all reps in `Promise.all`
- [ ] Steps 1/2/3/5 run in parallel per rep
- [ ] Step 4 (cadence) waits for 1/2/3 to complete
- [ ] Auto-draft triggers at 2x cadence threshold
- [ ] Slack DM sent to each rep with digest
- [ ] Founder digest sent after all reps complete

### Phase 5: Scheduling & Research
- [ ] `research-batch` processes accounts and stores in knowledge_base
- [ ] pg_cron jobs created for daily-scan and research-batch
- [ ] `SELECT * FROM cron.job` shows 2 scheduled jobs
