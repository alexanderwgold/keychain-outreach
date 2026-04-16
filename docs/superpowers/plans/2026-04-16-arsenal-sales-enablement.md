# Arsenal — Sales Enablement Library & Trackable Collateral — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `/arsenal` page that lets reps review admin-curated reference material, browse and send trackable collateral to prospects, and maintain a private "My Content" section. Every prospect-facing send produces a short link with per-open event tracking and per-prospect attribution.

**Architecture:** Three new Supabase tables (`arsenal_items`, `collateral_links`, `collateral_events`) with RLS. Admins upload PDFs/CSVs to a new Supabase Storage bucket; Drive URLs are stored verbatim. A Next.js route `/c/[slug]` handles redirects and logs events with insert-all + read-time bot filtering. Four new Supabase Edge Functions power link generation, stats reads, signed-upload URLs, and the extended Metabase CSV snapshot pipeline. The Gmail draft flow is extended to fetch Drive-hosted files via a new `drive.readonly` OAuth scope.

**Tech Stack:** Supabase (Postgres + Storage + Edge Functions/Deno), Next.js 16 App Router with Fluid Compute, React 19, shadcn/ui, Google Drive API v3.

**Spec:** `docs/superpowers/specs/2026-04-16-arsenal-sales-enablement-design.md`

---

## File Structure

### New migrations
- `supabase/migrations/011_arsenal_tables.sql` — `arsenal_items`, `collateral_links`, `collateral_events` tables, indexes, `update_updated_at` trigger
- `supabase/migrations/012_arsenal_rls.sql` — RLS policies for all three tables
- `supabase/migrations/013_arsenal_storage.sql` — Storage bucket `arsenal` + bucket policies

### New Edge Functions
- `supabase/functions/arsenal-create-link/index.ts` — generate or reuse a short link for (rep, item, prospect)
- `supabase/functions/arsenal-stats/index.ts` — aggregate open counts with bot filter, scoped to caller
- `supabase/functions/arsenal-upload-url/index.ts` — signed upload URL for admin Storage uploads
- `supabase/functions/_shared/bot-filter.ts` — shared UA-pattern helper (used by stats + redirect)
- `supabase/functions/_shared/drive-download.ts` — shared helper that fetches a Drive file's bytes given a rep's access token

### Modified Edge Functions
- `supabase/functions/create-gmail-draft/index.ts` — accept `driveFileId` in attachments array; fetch via Drive API
- `supabase/functions/ingest-metabase/index.ts` — on successful ingest, save the raw CSV to Storage and register a `type='report'` arsenal item

### New frontend files
- `frontend/src/app/(app)/arsenal/page.tsx` — rep-facing Arsenal page
- `frontend/src/app/(admin)/admin/arsenal/page.tsx` — admin-facing curation page
- `frontend/src/app/c/[slug]/route.ts` — redirect handler (Node runtime)
- `frontend/src/lib/data/arsenal.ts` — server-side data fetchers
- `frontend/src/lib/data/arsenal.test.ts` — unit tests for shape + filter logic
- `frontend/src/components/arsenal/arsenal-shelf.tsx` — tabbed shelf (Reference · Collateral · Reports)
- `frontend/src/components/arsenal/arsenal-tile.tsx` — tile card
- `frontend/src/components/arsenal/arsenal-drawer.tsx` — preview + send + stats drawer
- `frontend/src/components/arsenal/my-content-section.tsx` — private shelf
- `frontend/src/components/arsenal/add-item-dialog.tsx` — paste URL or upload PDF
- `frontend/src/components/arsenal/admin-item-row.tsx` — admin edit/reorder row

### Modified frontend files
- `frontend/src/components/auth/google-login-button.tsx` — add `drive.readonly` scope
- `frontend/src/components/layout/app-nav.tsx` — add "Arsenal" nav entry
- `frontend/src/components/drafting/draft-drawer.tsx` — accept `prefillBody` and `driveFileId` props
- `frontend/src/lib/types.ts` — add `ArsenalItem`, `CollateralLink`, `CollateralEvent`
- `frontend/src/lib/constants.ts` — add `ARSENAL_BUCKET = "arsenal"` + bot UA patterns

### Docs
- `docs/database.md` — add arsenal section
- `docs/edge-functions.md` — add new function entries
- `docs/auth.md` — document `drive.readonly` scope and re-consent flow
- `docs/frontend.md` — add `/arsenal` route entries

---

## Design Decisions (locked during spec refinement)

1. PDFs: **both** Supabase Storage bucket (admin uploads) AND Drive links (admin or rep pastes URL).
2. Metabase reports: **snapshot CSV exports** stored in Supabase Storage.
3. Per-prospect tracking: **v1**. `collateral_links` keys on `(item_id, rep_email, prospect_email, active)`. `prospect_email` is nullable for the "copy generic link" path.
4. Bot filtering: **insert-all, filter-at-read-time**. Bot patterns live in `_shared/bot-filter.ts` and are shared by stats queries.
5. Drive attachments: **add `drive.readonly` OAuth scope**. Existing users must re-consent. `create-gmail-draft` accepts `{ driveFileId }` and downloads bytes at draft time.
6. Admin deletes: **soft-disable**. `arsenal_items.active` bool; redirect handler returns 410 Gone with "no longer available" message when `active = false`.

---

## Phase 1: Database schema and Storage bucket

### Task 1.1: Create `arsenal_items` table

**Files:**
- Create: `supabase/migrations/011_arsenal_tables.sql`

- [ ] **Step 1: Create the migration with the `arsenal_items` table definition**

```sql
-- supabase/migrations/011_arsenal_tables.sql

create table arsenal_items (
  id uuid primary key default gen_random_uuid(),
  visibility text not null check (visibility in ('global', 'private')),
  owner_email text references rep_tokens(rep_email) on delete cascade,
  type text not null check (type in ('reference', 'collateral', 'report')),
  title text not null,
  description text not null default '',
  url text not null,
  storage_path text,
  thumbnail_url text,
  tags text[] not null default '{}',
  sort_order int not null default 0,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_email_required_for_private
    check (
      (visibility = 'private' and owner_email is not null)
      or (visibility = 'global' and owner_email is null)
    )
);

create index idx_arsenal_items_vis_type on arsenal_items (visibility, type) where active;
create index idx_arsenal_items_owner on arsenal_items (owner_email, type) where active;
create index idx_arsenal_items_tags on arsenal_items using gin (tags);

create trigger update_arsenal_items_updated_at
  before update on arsenal_items
  for each row execute function update_updated_at();
```

- [ ] **Step 2: Apply via Supabase MCP and verify**

Run (via mcp__supabase__apply_migration): `name: "arsenal_tables"`, content: the SQL above.

Then (via mcp__supabase__execute_sql):

```sql
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'arsenal_items';
```

Expected: one row `arsenal_items`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/011_arsenal_tables.sql
git commit -m "feat(arsenal): add arsenal_items table"
```

### Task 1.2: Add `collateral_links` and `collateral_events` tables

**Files:**
- Modify: `supabase/migrations/011_arsenal_tables.sql`

- [ ] **Step 1: Append to the migration file**

```sql
-- collateral_links: short URL per (rep, item, prospect) triple
create table collateral_links (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  item_id uuid not null references arsenal_items(id) on delete cascade,
  rep_email text not null references rep_tokens(rep_email) on delete cascade,
  prospect_email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One active link per (item, rep, prospect). NULL prospect gets its own active slot.
create unique index idx_collateral_links_unique_active
  on collateral_links (item_id, rep_email, coalesce(prospect_email, ''))
  where active;

-- collateral_events: each open is a row
create table collateral_events (
  id bigserial primary key,
  link_id uuid not null references collateral_links(id) on delete cascade,
  event_type text not null check (event_type in ('opened', 'downloaded')),
  user_agent text,
  ip_prefix text,
  referrer text,
  created_at timestamptz not null default now()
);

create index idx_collateral_events_link_time on collateral_events (link_id, created_at desc);
```

- [ ] **Step 2: Apply via Supabase MCP**

Use mcp__supabase__apply_migration with name `collateral_links_and_events` and the appended SQL.

- [ ] **Step 3: Verify tables exist**

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('collateral_links', 'collateral_events')
order by table_name;
```

Expected: two rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/011_arsenal_tables.sql
git commit -m "feat(arsenal): add collateral_links and collateral_events tables"
```

### Task 1.3: RLS policies

**Files:**
- Create: `supabase/migrations/012_arsenal_rls.sql`

- [ ] **Step 1: Write the policies file**

```sql
-- supabase/migrations/012_arsenal_rls.sql

alter table arsenal_items enable row level security;
alter table collateral_links enable row level security;
alter table collateral_events enable row level security;

-- arsenal_items: SELECT
create policy "arsenal_items_select_global_or_owner" on arsenal_items
  for select using (
    visibility = 'global'
    or owner_email = (auth.jwt() ->> 'email')
  );

-- arsenal_items: INSERT — admins create global, reps create their own private
create policy "arsenal_items_insert_admin_global" on arsenal_items
  for insert with check (
    visibility = 'global'
    and (auth.jwt() ->> 'email') in (
      select unnest(string_to_array(current_setting('app.admin_emails', true), ','))
    )
  );

create policy "arsenal_items_insert_rep_private" on arsenal_items
  for insert with check (
    visibility = 'private'
    and owner_email = (auth.jwt() ->> 'email')
    and created_by = (auth.jwt() ->> 'email')
  );

-- arsenal_items: UPDATE/DELETE — admins on global, owners on private
create policy "arsenal_items_update_admin_global" on arsenal_items
  for update using (
    visibility = 'global'
    and (auth.jwt() ->> 'email') in (
      select unnest(string_to_array(current_setting('app.admin_emails', true), ','))
    )
  );

create policy "arsenal_items_update_owner_private" on arsenal_items
  for update using (
    visibility = 'private'
    and owner_email = (auth.jwt() ->> 'email')
  );

create policy "arsenal_items_delete_admin_global" on arsenal_items
  for delete using (
    visibility = 'global'
    and (auth.jwt() ->> 'email') in (
      select unnest(string_to_array(current_setting('app.admin_emails', true), ','))
    )
  );

create policy "arsenal_items_delete_owner_private" on arsenal_items
  for delete using (
    visibility = 'private'
    and owner_email = (auth.jwt() ->> 'email')
  );

-- collateral_links
create policy "collateral_links_select_own_or_admin" on collateral_links
  for select using (
    rep_email = (auth.jwt() ->> 'email')
    or (auth.jwt() ->> 'email') in (
      select unnest(string_to_array(current_setting('app.admin_emails', true), ','))
    )
  );

create policy "collateral_links_insert_own" on collateral_links
  for insert with check (rep_email = (auth.jwt() ->> 'email'));

create policy "collateral_links_update_own" on collateral_links
  for update using (rep_email = (auth.jwt() ->> 'email'));

-- collateral_events: SELECT scoped by link ownership
create policy "collateral_events_select_via_link_owner" on collateral_events
  for select using (
    exists (
      select 1 from collateral_links l
      where l.id = collateral_events.link_id
        and (l.rep_email = (auth.jwt() ->> 'email')
             or (auth.jwt() ->> 'email') in (
               select unnest(string_to_array(current_setting('app.admin_emails', true), ','))
             ))
    )
  );

-- No INSERT policy on collateral_events — inserts happen via service role only
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `arsenal_rls`.

- [ ] **Step 3: Verify policies exist**

```sql
select tablename, policyname from pg_policies
where tablename in ('arsenal_items', 'collateral_links', 'collateral_events')
order by tablename, policyname;
```

Expected: at least 9 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/012_arsenal_rls.sql
git commit -m "feat(arsenal): add RLS policies for arsenal tables"
```

### Task 1.4: Storage bucket and bucket policies

**Files:**
- Create: `supabase/migrations/013_arsenal_storage.sql`

- [ ] **Step 1: Write the bucket setup**

```sql
-- supabase/migrations/013_arsenal_storage.sql

-- Create the bucket (public = false; access through signed URLs only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arsenal',
  'arsenal',
  false,
  52428800, -- 50 MB
  array['application/pdf', 'text/csv', 'image/png', 'image/jpeg']
) on conflict (id) do nothing;

-- SELECT: anyone authenticated can read (needed by redirect handler; service role also works)
create policy "arsenal_storage_read_authed" on storage.objects
  for select using (bucket_id = 'arsenal' and auth.role() = 'authenticated');

-- INSERT: admins upload global, reps upload under their own prefix `private/{email}/...`
create policy "arsenal_storage_insert_admin_global" on storage.objects
  for insert with check (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'global'
    and (auth.jwt() ->> 'email') in (
      select unnest(string_to_array(current_setting('app.admin_emails', true), ','))
    )
  );

create policy "arsenal_storage_insert_rep_private" on storage.objects
  for insert with check (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'private'
    and (storage.foldername(name))[2] = (auth.jwt() ->> 'email')
  );

-- DELETE: owners can delete their own objects; admins can delete global
create policy "arsenal_storage_delete_admin_global" on storage.objects
  for delete using (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'global'
    and (auth.jwt() ->> 'email') in (
      select unnest(string_to_array(current_setting('app.admin_emails', true), ','))
    )
  );

create policy "arsenal_storage_delete_rep_private" on storage.objects
  for delete using (
    bucket_id = 'arsenal'
    and (storage.foldername(name))[1] = 'private'
    and (storage.foldername(name))[2] = (auth.jwt() ->> 'email')
  );
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `arsenal_storage`.

- [ ] **Step 3: Verify bucket exists**

```sql
select id, name, public, file_size_limit from storage.buckets where id = 'arsenal';
```

Expected: one row with `public = false`, `file_size_limit = 52428800`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/013_arsenal_storage.sql
git commit -m "feat(arsenal): add Storage bucket and policies"
```

### Task 1.5: Extend TypeScript types

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Regenerate Supabase types via MCP**

Call `mcp__supabase__generate_typescript_types`, copy the new `arsenal_items`, `collateral_links`, `collateral_events` blocks into the existing Supabase types file.

- [ ] **Step 2: Add app-level convenience types to `frontend/src/lib/types.ts`**

```ts
import type { Tables } from "./supabase-types" // or wherever Supabase-generated types live

export type ArsenalItem = Tables<"arsenal_items">
export type CollateralLink = Tables<"collateral_links">
export type CollateralEvent = Tables<"collateral_events">

export type ArsenalItemWithStats = ArsenalItem & {
  openCount: number
  lastOpenedAt: string | null
  linkSlug: string | null
}

export type ArsenalShelf = "reference" | "collateral" | "report"
```

- [ ] **Step 3: Typecheck passes**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/supabase-types.ts
git commit -m "feat(arsenal): add TypeScript types for arsenal tables"
```

---

## Phase 2: Bot filter + redirect handler

### Task 2.1: Shared bot-filter module with tests

**Files:**
- Create: `supabase/functions/_shared/bot-filter.ts`
- Create: `supabase/functions/_shared/bot-filter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// supabase/functions/_shared/bot-filter.test.ts

import { assertEquals } from "https://deno.land/std@0.218.2/assert/mod.ts"
import { isBotUserAgent } from "./bot-filter.ts"

Deno.test("isBotUserAgent: flags GoogleImageProxy (Gmail preview fetcher)", () => {
  assertEquals(isBotUserAgent("GoogleImageProxy"), true)
  assertEquals(
    isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    true,
  )
})

Deno.test("isBotUserAgent: flags Slack unfurler", () => {
  assertEquals(isBotUserAgent("Slackbot-LinkExpanding 1.0"), true)
})

Deno.test("isBotUserAgent: flags Outlook SafeLinks", () => {
  assertEquals(
    isBotUserAgent("Mozilla/5.0 (compatible; Microsoft Outlook SafeLinks)"),
    true,
  )
})

Deno.test("isBotUserAgent: flags common automation", () => {
  assertEquals(isBotUserAgent("Python-urllib/3.11"), true)
  assertEquals(isBotUserAgent("curl/8.4.0"), true)
  assertEquals(isBotUserAgent(""), true) // empty UA is suspicious
  assertEquals(isBotUserAgent(null), true)
})

Deno.test("isBotUserAgent: passes real browsers", () => {
  const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
  assertEquals(isBotUserAgent(chrome), false)
  assertEquals(isBotUserAgent(safari), false)
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd supabase/functions/_shared && deno test bot-filter.test.ts
```

Expected: "Could not find module 'bot-filter.ts'".

- [ ] **Step 3: Implement `bot-filter.ts`**

```ts
// supabase/functions/_shared/bot-filter.ts

const BOT_PATTERNS = [
  /googlebot/i,
  /googleimageproxy/i,
  /bingbot/i,
  /yahoo! slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /slackbot-linkexpanding/i,
  /slackbot/i,
  /discordbot/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /safelinks/i,
  /mimecast/i,
  /proofpoint/i,
  /barracuda/i,
  /python/i,
  /curl\//i,
  /wget/i,
  /headlesschrome/i,
  /bot$/i,
  /spider/i,
  /crawler/i,
]

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.trim() === "") return true
  return BOT_PATTERNS.some((pattern) => pattern.test(ua))
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd supabase/functions/_shared && deno test bot-filter.test.ts
```

Expected: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/bot-filter.ts supabase/functions/_shared/bot-filter.test.ts
git commit -m "feat(arsenal): add shared bot-filter module with tests"
```

### Task 2.2: Redirect route handler

**Files:**
- Create: `frontend/src/app/c/[slug]/route.ts`

- [ ] **Step 1: Write the handler**

```ts
// frontend/src/app/c/[slug]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Use Node runtime for the service-role client; Fluid Compute keeps this fast.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function truncateIp(raw: string | null): string | null {
  if (!raw) return null
  // x-forwarded-for may contain multiple IPs; take the first
  const ip = raw.split(",")[0].trim()
  if (ip.includes(":")) {
    // IPv6 → /48 (first 3 hextets)
    const parts = ip.split(":")
    return parts.slice(0, 3).join(":") + "::/48"
  }
  // IPv4 → /24
  const octets = ip.split(".")
  if (octets.length !== 4) return null
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: link } = await supabase
    .from("collateral_links")
    .select("id, active, item_id, arsenal_items(url, active)")
    .eq("slug", slug)
    .maybeSingle()

  if (!link || !link.active || !link.arsenal_items?.active) {
    return new NextResponse(
      "<!doctype html><title>Content unavailable</title><body style=\"font-family:system-ui;margin:3rem auto;max-width:420px;padding:0 1rem\"><h1>This content is no longer available</h1><p>The person who shared this link may have removed or updated it.</p></body>",
      { status: 410, headers: { "content-type": "text/html" } },
    )
  }

  // Fire-and-forget insert — await to ensure Fluid Compute doesn't kill it
  await supabase.from("collateral_events").insert({
    link_id: link.id,
    event_type: "opened",
    user_agent: request.headers.get("user-agent"),
    ip_prefix: truncateIp(request.headers.get("x-forwarded-for")),
    referrer: request.headers.get("referer"),
  })

  return NextResponse.redirect(link.arsenal_items.url, 302)
}
```

- [ ] **Step 2: Typecheck passes**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual verification**

Locally:
1. Seed one test `arsenal_items` row (global, visible to yourself) via Supabase SQL.
2. Seed one `collateral_links` row pointing to it with slug `test123`, `active = true`.
3. `curl -v -A "Mozilla/5.0 Chrome" https://<local-or-preview>/c/test123`
4. Verify 302 with `Location: <item url>`.
5. Query `select * from collateral_events order by created_at desc limit 1;` — expect one new row.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/c/[slug]/route.ts
git commit -m "feat(arsenal): add /c/[slug] redirect route with event logging"
```

---

## Phase 3: Edge Functions for link generation, stats, and uploads

### Task 3.1: `arsenal-create-link`

**Files:**
- Create: `supabase/functions/arsenal-create-link/index.ts`

- [ ] **Step 1: Implement the function**

```ts
// supabase/functions/arsenal-create-link/index.ts

import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { getAuthedEmail } from "../_shared/auth.ts"

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

function makeSlug(length = 8): string {
  let out = ""
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  for (const b of bytes) out += BASE62[b % BASE62.length]
  return out
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const authed = await getAuthedEmail(req)
  if (!authed.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }
  const repEmail = authed.email

  const { itemId, prospectEmail } = await req.json().catch(() => ({}))
  if (!itemId) {
    return new Response(JSON.stringify({ error: "itemId required" }), {
      status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // Enforce read access on the item
  const { data: item } = await admin
    .from("arsenal_items")
    .select("id, visibility, owner_email, active")
    .eq("id", itemId)
    .maybeSingle()

  if (!item || !item.active) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }
  const canRead =
    item.visibility === "global" ||
    (item.visibility === "private" && item.owner_email === repEmail)
  if (!canRead) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  // Reuse existing active link if one matches
  const { data: existing } = await admin
    .from("collateral_links")
    .select("slug")
    .eq("item_id", itemId)
    .eq("rep_email", repEmail)
    .filter("prospect_email", prospectEmail ? "eq" : "is", prospectEmail ?? null)
    .eq("active", true)
    .maybeSingle()
  if (existing) {
    return jsonOk({ slug: existing.slug })
  }

  // Generate a unique slug (retry on unique violation up to 3 times)
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = makeSlug()
    const { error } = await admin.from("collateral_links").insert({
      slug,
      item_id: itemId,
      rep_email: repEmail,
      prospect_email: prospectEmail ?? null,
    })
    if (!error) return jsonOk({ slug })
    if (error.code !== "23505") { // not a unique-violation
      lastErr = error
      break
    }
  }
  return new Response(JSON.stringify({ error: "slug_collision", detail: String(lastErr) }), {
    status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
  })
})

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
  })
}
```

- [ ] **Step 2: Deploy via Supabase MCP**

Use `mcp__supabase__deploy_edge_function` with name `arsenal-create-link`.

- [ ] **Step 3: Smoke-test**

Run via `curl`:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/arsenal-create-link" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"<seeded-item-uuid>","prospectEmail":"test@example.com"}'
```

Expected: `{"slug":"<8-char-slug>"}`. Running again with same inputs returns the same slug.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/arsenal-create-link/index.ts
git commit -m "feat(arsenal): add arsenal-create-link Edge Function"
```

### Task 3.2: `arsenal-stats`

**Files:**
- Create: `supabase/functions/arsenal-stats/index.ts`

- [ ] **Step 1: Implement**

```ts
// supabase/functions/arsenal-stats/index.ts

import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { getAuthedEmail } from "../_shared/auth.ts"
import { isBotUserAgent } from "../_shared/bot-filter.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const authed = await getAuthedEmail(req)
  if (!authed.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }
  const repEmail = authed.email

  const url = new URL(req.url)
  const ids = (url.searchParams.get("itemIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    return jsonOk({})
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const { data: links } = await admin
    .from("collateral_links")
    .select("id, slug, item_id, collateral_events(user_agent, created_at)")
    .in("item_id", ids)
    .eq("rep_email", repEmail)
    .eq("active", true)

  const result: Record<string, { openCount: number; lastOpenedAt: string | null; linkSlug: string | null }> = {}
  for (const id of ids) result[id] = { openCount: 0, lastOpenedAt: null, linkSlug: null }

  for (const link of links ?? []) {
    const entry = result[link.item_id]
    entry.linkSlug = link.slug
    const humanEvents = (link.collateral_events ?? [])
      .filter((e: { user_agent: string | null }) => !isBotUserAgent(e.user_agent))
    entry.openCount += humanEvents.length
    for (const e of humanEvents) {
      if (!entry.lastOpenedAt || e.created_at > entry.lastOpenedAt) {
        entry.lastOpenedAt = e.created_at
      }
    }
  }
  return jsonOk(result)
})

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
  })
}
```

- [ ] **Step 2: Deploy**

Use `mcp__supabase__deploy_edge_function` with name `arsenal-stats`.

- [ ] **Step 3: Smoke-test**

```bash
curl "$SUPABASE_URL/functions/v1/arsenal-stats?itemIds=<id1>,<id2>" \
  -H "Authorization: Bearer $USER_JWT"
```

Expected: `{"<id1>":{"openCount":0,"lastOpenedAt":null,"linkSlug":null}, ...}` for a fresh item; non-zero after one test redirect with a browser UA.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/arsenal-stats/index.ts
git commit -m "feat(arsenal): add arsenal-stats Edge Function with read-time bot filter"
```

### Task 3.3: `arsenal-upload-url` — signed upload URL for admins

**Files:**
- Create: `supabase/functions/arsenal-upload-url/index.ts`

- [ ] **Step 1: Implement**

```ts
// supabase/functions/arsenal-upload-url/index.ts

import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { getAuthedEmail } from "../_shared/auth.ts"

const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map(s => s.trim()).filter(Boolean)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const authed = await getAuthedEmail(req)
  if (!authed.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const { filename, scope } = await req.json().catch(() => ({}))
  if (!filename || !["global", "private"].includes(scope)) {
    return new Response(JSON.stringify({ error: "filename and scope required" }), {
      status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  if (scope === "global" && !ADMIN_EMAILS.includes(authed.email)) {
    return new Response(JSON.stringify({ error: "admin_required" }), {
      status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  const key = scope === "global"
    ? `global/${crypto.randomUUID()}-${safe}`
    : `private/${authed.email}/${crypto.randomUUID()}-${safe}`

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const { data, error } = await admin.storage.from("arsenal").createSignedUploadUrl(key)
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  return new Response(JSON.stringify({
    uploadUrl: data.signedUrl,
    token: data.token,
    path: key,
  }), {
    status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
  })
})
```

- [ ] **Step 2: Deploy**

Use `mcp__supabase__deploy_edge_function` with name `arsenal-upload-url`.

- [ ] **Step 3: Smoke-test**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/arsenal-upload-url" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename":"case-study.pdf","scope":"global"}'
```

Expected: JSON with `uploadUrl`, `token`, `path` fields.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/arsenal-upload-url/index.ts
git commit -m "feat(arsenal): add arsenal-upload-url Edge Function for Storage uploads"
```

---

## Phase 4: Drive OAuth scope + download helper + draft integration

### Task 4.1: Add `drive.readonly` to OAuth scopes

**Files:**
- Modify: `frontend/src/components/auth/google-login-button.tsx`

- [ ] **Step 1: Add scope**

Change line 7-12 (the `GOOGLE_SCOPES` constant):

```ts
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ")
```

- [ ] **Step 2: Enable the Drive API scope in Google Cloud Console**

In the Cloud Console OAuth consent screen → Scopes, add `.../auth/drive.readonly`. Also verify the Drive API is enabled: Cloud Console → APIs & Services → Enabled APIs. Add Drive API if missing.

- [ ] **Step 3: Document the re-consent requirement in `docs/auth.md`**

Append a section:

```markdown
## Drive scope (added 2026-04-16)

The OAuth flow requests `drive.readonly` to let reps attach Drive-hosted
files to Gmail drafts. Existing reps must re-consent on their next login.
Users who decline this scope cannot use the "Attach Drive file" toggle
but can still send trackable links.
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/auth/google-login-button.tsx docs/auth.md
git commit -m "feat(arsenal): add Drive.readonly OAuth scope"
```

### Task 4.2: Drive download helper

**Files:**
- Create: `supabase/functions/_shared/drive-download.ts`

- [ ] **Step 1: Implement**

```ts
// supabase/functions/_shared/drive-download.ts

export type DriveFile = {
  bytes: Uint8Array
  mimeType: string
  filename: string
}

export async function downloadDriveFile(
  fileId: string,
  accessToken: string,
): Promise<DriveFile> {
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!metaRes.ok) {
    throw new Error(`Drive metadata fetch failed: ${metaRes.status}`)
  }
  const meta = await metaRes.json() as { name: string; mimeType: string }

  // Google-native files (Docs, Sheets, Slides) need an export; binary files use get?alt=media
  const isNative = meta.mimeType.startsWith("application/vnd.google-apps")
  let downloadUrl: string
  let effectiveMime: string
  let effectiveName = meta.name

  if (isNative) {
    const exportMap: Record<string, { mime: string; ext: string }> = {
      "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
      "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
      "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: ".csv" },
    }
    const cfg = exportMap[meta.mimeType] ?? { mime: "application/pdf", ext: ".pdf" }
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(cfg.mime)}`
    effectiveMime = cfg.mime
    if (!effectiveName.endsWith(cfg.ext)) effectiveName += cfg.ext
  } else {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    effectiveMime = meta.mimeType
  }

  const fileRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!fileRes.ok) {
    throw new Error(`Drive download failed: ${fileRes.status}`)
  }
  const bytes = new Uint8Array(await fileRes.arrayBuffer())
  return { bytes, mimeType: effectiveMime, filename: effectiveName }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/drive-download.ts
git commit -m "feat(arsenal): add Drive download helper for native + binary files"
```

### Task 4.3: Extend `create-gmail-draft` to accept Drive source

**Files:**
- Modify: `supabase/functions/create-gmail-draft/index.ts`

- [ ] **Step 1: Add Drive branch to the attachments loop**

Locate the block that iterates `attachments` and attaches bytes via the MIME builder. Before the loop, import the helper:

```ts
import { downloadDriveFile } from "../_shared/drive-download.ts"
```

Inside the loop, add handling for a new `driveFileId` field. The existing path handles `{ bucket, path }`. New path handles `{ driveFileId }`:

```ts
for (const attachment of attachments ?? []) {
  if (attachment.driveFileId) {
    const drive = await downloadDriveFile(attachment.driveFileId, accessToken)
    mimeParts.push({
      filename: drive.filename,
      mimeType: drive.mimeType,
      bytes: drive.bytes,
    })
    continue
  }
  // ...existing Supabase Storage path
}
```

(`accessToken` is the rep's Google access token already obtained earlier in the function via `refreshGoogleToken`.)

- [ ] **Step 2: Redeploy**

Use `mcp__supabase__deploy_edge_function` with name `create-gmail-draft`.

- [ ] **Step 3: Smoke-test**

Manually invoke `create-gmail-draft` with an attachment body of `[{ driveFileId: "<test file id>" }]`. Expected: draft created in Gmail with the Drive file attached as a PDF (for Docs) or the native binary.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-gmail-draft/index.ts
git commit -m "feat(arsenal): support Drive file attachments in create-gmail-draft"
```

---

## Phase 5: Admin UI

### Task 5.1: Server-side admin data fetcher

**Files:**
- Create: `frontend/src/lib/data/arsenal.ts`

- [ ] **Step 1: Implement the global-items fetcher**

```ts
import "server-only"

import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/server"
import type { ArsenalItem } from "@/lib/types"

export async function getGlobalArsenalItems(): Promise<ArsenalItem[]> {
  return Sentry.startSpan({ name: "arsenal.getGlobalArsenalItems", op: "db.query" }, async () => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("arsenal_items")
      .select("*")
      .eq("visibility", "global")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })

    if (error) { Sentry.captureException(error); return [] }
    return data ?? []
  })
}
```

- [ ] **Step 2: Add rep-facing combined fetcher**

```ts
export async function getRepArsenalItems(repEmail: string): Promise<{
  global: ArsenalItem[]
  mine: ArsenalItem[]
}> {
  return Sentry.startSpan({ name: "arsenal.getRepArsenalItems", op: "db.query" }, async () => {
    const supabase = await createClient()
    const [globalRes, mineRes] = await Promise.all([
      supabase.from("arsenal_items").select("*")
        .eq("visibility", "global").eq("active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase.from("arsenal_items").select("*")
        .eq("visibility", "private")
        .eq("owner_email", repEmail)
        .eq("active", true)
        .order("created_at", { ascending: false }),
    ])
    if (globalRes.error) Sentry.captureException(globalRes.error)
    if (mineRes.error) Sentry.captureException(mineRes.error)
    return {
      global: globalRes.data ?? [],
      mine: mineRes.data ?? [],
    }
  })
}
```

- [ ] **Step 3: Add tests**

File: `frontend/src/lib/data/arsenal.test.ts`

```ts
import { describe, it, expect, vi } from "vitest"
import { getRepArsenalItems } from "./arsenal"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolve: any) =>
          resolve({
            data: table === "arsenal_items" ? [{ id: "a", visibility: "global" }] : [],
            error: null,
          }),
      }
      return chain
    }),
  })),
}))

describe("getRepArsenalItems", () => {
  it("returns split global and mine arrays", async () => {
    const r = await getRepArsenalItems("rep@keychain.com")
    expect(r.global).toHaveLength(1)
    expect(r.mine).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm test -- arsenal.test
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/data/arsenal.ts frontend/src/lib/data/arsenal.test.ts
git commit -m "feat(arsenal): add server-side data fetchers"
```

### Task 5.2: Admin page shell

**Files:**
- Create: `frontend/src/app/(admin)/admin/arsenal/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Suspense } from "react"
import { getGlobalArsenalItems } from "@/lib/data/arsenal"
import { AdminArsenalClient } from "@/components/arsenal/admin-arsenal-client"

export default async function AdminArsenalPage() {
  const items = await getGlobalArsenalItems()
  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-kc-charcoal">Arsenal · Shared Library</h1>
        <p className="text-sm text-kc-text-muted">
          Manage the content every rep sees. Soft-deletes preserve historical links.
        </p>
      </header>
      <Suspense>
        <AdminArsenalClient initialItems={items} />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(admin)/admin/arsenal/page.tsx
git commit -m "feat(arsenal): add admin Arsenal page shell"
```

### Task 5.3: Admin client component with tabbed shelves and row editor

**Files:**
- Create: `frontend/src/components/arsenal/admin-arsenal-client.tsx`
- Create: `frontend/src/components/arsenal/admin-item-row.tsx`

- [ ] **Step 1: Implement `admin-arsenal-client.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import type { ArsenalItem, ArsenalShelf } from "@/lib/types"
import { AdminItemRow } from "./admin-item-row"
import { AddItemDialog } from "./add-item-dialog"
import { Button } from "@/components/ui/button"

const TABS: { key: ArsenalShelf; label: string }[] = [
  { key: "reference", label: "Reference" },
  { key: "collateral", label: "Collateral" },
  { key: "report", label: "Reports" },
]

export function AdminArsenalClient({ initialItems }: { initialItems: ArsenalItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [tab, setTab] = useState<ArsenalShelf>("reference")
  const [addOpen, setAddOpen] = useState(false)

  const visible = useMemo(
    () => items.filter((i) => i.type === tab).sort((a, b) => a.sort_order - b.sort_order),
    [items, tab],
  )

  return (
    <div className="space-y-4">
      <nav className="flex gap-4 border-b border-kc-warm-gray-dark">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-3 text-sm font-medium ${
              tab === t.key ? "border-b-2 border-kc-gold text-kc-charcoal" : "text-kc-text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto self-center">
          <Button size="sm" onClick={() => setAddOpen(true)}>Add item</Button>
        </div>
      </nav>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-kc-text-muted">
          No items yet. Click "Add item" to get started.
        </p>
      ) : (
        <ul className="divide-y divide-kc-warm-gray-dark">
          {visible.map((item) => (
            <AdminItemRow
              key={item.id}
              item={item}
              onChange={(updated) =>
                setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
              }
              onSoftDelete={(id) =>
                setItems((prev) => prev.map((i) => (i.id === id ? { ...i, active: false } : i)))
              }
            />
          ))}
        </ul>
      )}

      <AddItemDialog
        scope="global"
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultType={tab}
        onCreated={(item) => setItems((prev) => [item, ...prev])}
      />
    </div>
  )
}
```

- [ ] **Step 2: Implement `admin-item-row.tsx`**

```tsx
"use client"

import { useState } from "react"
import type { ArsenalItem } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

export function AdminItemRow({
  item,
  onChange,
  onSoftDelete,
}: {
  item: ArsenalItem
  onChange: (updated: ArsenalItem) => void
  onSoftDelete: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function softDelete() {
    if (!confirm(`Remove "${item.title}" from the Library? Existing sent links will return "no longer available".`)) return
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase
      .from("arsenal_items")
      .update({ active: false })
      .eq("id", item.id)
    setBusy(false)
    if (error) { alert(error.message); return }
    onSoftDelete(item.id)
  }

  return (
    <li className="flex items-start gap-4 py-3">
      <div className="flex-1">
        <p className="font-medium text-kc-charcoal">{item.title}</p>
        {item.description && <p className="mt-1 text-sm text-kc-text-muted">{item.description}</p>}
        <p className="mt-1 font-mono text-xs text-kc-text-muted">{item.url}</p>
        {item.tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <li key={t} className="rounded-full bg-kc-warm-gray px-2 py-0.5 text-xs text-kc-charcoal">{t}</li>
            ))}
          </ul>
        )}
      </div>
      <Button variant="ghost" size="icon" onClick={softDelete} disabled={busy} aria-label="Remove">
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/arsenal/admin-arsenal-client.tsx frontend/src/components/arsenal/admin-item-row.tsx
git commit -m "feat(arsenal): add admin Arsenal client with tabs and row editor"
```

### Task 5.4: Add-item dialog (URL paste + Storage upload)

**Files:**
- Create: `frontend/src/components/arsenal/add-item-dialog.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client"

import { useState } from "react"
import type { ArsenalItem, ArsenalShelf } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function AddItemDialog({
  scope,
  open,
  onOpenChange,
  defaultType,
  onCreated,
}: {
  scope: "global" | "private"
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultType: ArsenalShelf
  onCreated: (item: ArsenalItem) => void
}) {
  const [source, setSource] = useState<"url" | "upload">("url")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [url, setUrl] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [type, setType] = useState<ArsenalShelf>(defaultType)
  const [tagsText, setTagsText] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!open) return null

  async function uploadToStorage(f: File): Promise<{ url: string; storagePath: string }> {
    const supabase = createClient()
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: f.name, scope }),
    })
    if (!res.ok) throw new Error(await res.text())
    const { uploadUrl, path } = await res.json()
    const putRes = await fetch(uploadUrl, { method: "PUT", body: f, headers: { "content-type": f.type } })
    if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`)
    const { data: { publicUrl } } = supabase.storage.from("arsenal").getPublicUrl(path)
    return { url: publicUrl, storagePath: path }
  }

  async function submit() {
    setErr(null); setBusy(true)
    try {
      const supabase = createClient()
      let finalUrl = url
      let storagePath: string | null = null
      if (source === "upload") {
        if (!file) throw new Error("Pick a file")
        const up = await uploadToStorage(file)
        finalUrl = up.url
        storagePath = up.storagePath
      }
      const tags = tagsText.split(",").map((s) => s.trim()).filter(Boolean)
      const { data: user } = await supabase.auth.getUser()
      const email = user.user?.email
      if (!email) throw new Error("Not signed in")
      const { data, error } = await supabase.from("arsenal_items").insert({
        visibility: scope,
        owner_email: scope === "private" ? email : null,
        type,
        title,
        description,
        url: finalUrl,
        storage_path: storagePath,
        tags,
        created_by: email,
      }).select("*").single()
      if (error) throw error
      onCreated(data)
      onOpenChange(false)
      setTitle(""); setDescription(""); setUrl(""); setFile(null); setTagsText("")
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-kc-charcoal">Add item</h2>

        <div className="flex gap-2 text-sm">
          <button onClick={() => setSource("url")} className={source === "url" ? "font-semibold" : "text-kc-text-muted"}>Paste URL</button>
          <span className="text-kc-text-muted">·</span>
          <button onClick={() => setSource("upload")} className={source === "upload" ? "font-semibold" : "text-kc-text-muted"}>Upload PDF/CSV</button>
        </div>

        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
        </label>

        {source === "url" ? (
          <label className="block space-y-1">
            <span className="text-sm text-kc-text">URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/..." className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="text-sm text-kc-text">File</span>
            <input type="file" accept="application/pdf,text/csv,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as ArsenalShelf)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm">
            <option value="reference">Reference</option>
            <option value="collateral">Collateral</option>
            <option value="report">Report</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-kc-text">Tags (comma-separated)</span>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} className="w-full rounded border border-kc-warm-gray-dark px-3 py-2 text-sm" />
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title || (source === "url" ? !url : !file)}>
            {busy ? "Adding..." : "Add"}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify dev build**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/arsenal/add-item-dialog.tsx
git commit -m "feat(arsenal): add AddItemDialog with URL + upload modes"
```

---

## Phase 6: Rep-facing Arsenal page

### Task 6.1: Rep Arsenal page shell

**Files:**
- Create: `frontend/src/app/(app)/arsenal/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getRepArsenalItems } from "@/lib/data/arsenal"
import { RepArsenalClient } from "@/components/arsenal/rep-arsenal-client"

export default async function ArsenalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect("/")

  const { global, mine } = await getRepArsenalItems(user.email)
  const itemIds = [...global.map((i) => i.id), ...mine.map((i) => i.id)]

  return <RepArsenalClient globalItems={global} mineItems={mine} repEmail={user.email} itemIds={itemIds} />
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/(app)/arsenal/page.tsx
git commit -m "feat(arsenal): add rep Arsenal page shell"
```

### Task 6.2: Rep client component with tile grid, drawer, and My Content

**Files:**
- Create: `frontend/src/components/arsenal/rep-arsenal-client.tsx`
- Create: `frontend/src/components/arsenal/arsenal-tile.tsx`
- Create: `frontend/src/components/arsenal/arsenal-drawer.tsx`

- [ ] **Step 1: Implement `rep-arsenal-client.tsx`**

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import type { ArsenalItem, ArsenalItemWithStats, ArsenalShelf } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { ArsenalTile } from "./arsenal-tile"
import { ArsenalDrawer } from "./arsenal-drawer"
import { AddItemDialog } from "./add-item-dialog"
import { Button } from "@/components/ui/button"

type Stats = Record<string, { openCount: number; lastOpenedAt: string | null; linkSlug: string | null }>

const TABS: { key: ArsenalShelf; label: string }[] = [
  { key: "reference", label: "Reference" },
  { key: "collateral", label: "Collateral" },
  { key: "report", label: "Reports" },
]

export function RepArsenalClient({
  globalItems,
  mineItems,
  repEmail,
  itemIds,
}: {
  globalItems: ArsenalItem[]
  mineItems: ArsenalItem[]
  repEmail: string
  itemIds: string[]
}) {
  const [tab, setTab] = useState<ArsenalShelf>("reference")
  const [activeItem, setActiveItem] = useState<ArsenalItem | null>(null)
  const [mine, setMine] = useState(mineItems)
  const [addOpen, setAddOpen] = useState(false)
  const [stats, setStats] = useState<Stats>({})

  useEffect(() => {
    if (itemIds.length === 0) return
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token
      if (!token) return
      fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-stats?itemIds=${itemIds.join(",")}`, {
        headers: { authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => setStats(data))
        .catch(() => { /* stats failure is non-critical */ })
    })
  }, [itemIds])

  const decorate = (items: ArsenalItem[]): ArsenalItemWithStats[] =>
    items.map((i) => ({
      ...i,
      openCount: stats[i.id]?.openCount ?? 0,
      lastOpenedAt: stats[i.id]?.lastOpenedAt ?? null,
      linkSlug: stats[i.id]?.linkSlug ?? null,
    }))

  const visibleGlobal = useMemo(
    () => decorate(globalItems.filter((i) => i.type === tab)),
    [globalItems, stats, tab],
  )

  return (
    <div className="space-y-10 p-6">
      <section>
        <h1 className="mb-1 text-2xl font-semibold text-kc-charcoal">Shared Library</h1>
        <p className="mb-4 text-sm text-kc-text-muted">Reference material, prospect collateral, and team reports.</p>

        <nav className="flex gap-4 border-b border-kc-warm-gray-dark">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`py-3 text-sm font-medium ${
                tab === t.key ? "border-b-2 border-kc-gold text-kc-charcoal" : "text-kc-text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {visibleGlobal.length === 0 ? (
          <p className="py-12 text-center text-sm text-kc-text-muted">Nothing here yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {visibleGlobal.map((i) => (
              <ArsenalTile key={i.id} item={i} onOpen={() => setActiveItem(i)} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-kc-charcoal">My Content</h2>
            <p className="text-sm text-kc-text-muted">Private — only you see these.</p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>Add item</Button>
        </div>
        {mine.length === 0 ? (
          <p className="py-12 text-center text-sm text-kc-text-muted">
            Save Drive links or PDFs you want quick access to.
          </p>
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {decorate(mine).map((i) => (
              <ArsenalTile key={i.id} item={i} onOpen={() => setActiveItem(i)} />
            ))}
          </ul>
        )}
      </section>

      <ArsenalDrawer
        item={activeItem}
        onClose={() => setActiveItem(null)}
        stats={activeItem ? stats[activeItem.id] ?? null : null}
      />

      <AddItemDialog
        scope="private"
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultType="collateral"
        onCreated={(item) => setMine((prev) => [item, ...prev])}
      />
    </div>
  )
}
```

- [ ] **Step 2: Implement `arsenal-tile.tsx`**

```tsx
"use client"

import type { ArsenalItemWithStats } from "@/lib/types"
import { formatDistanceToNowStrict } from "date-fns"

export function ArsenalTile({
  item,
  onOpen,
}: {
  item: ArsenalItemWithStats
  onOpen: () => void
}) {
  return (
    <li className="group flex flex-col gap-2 rounded-xl border border-kc-warm-gray-dark bg-white p-4 text-left transition hover:border-kc-gold hover:shadow-sm">
      <button onClick={onOpen} className="flex flex-1 flex-col gap-2 text-left">
        <span className="text-xs font-medium uppercase tracking-wide text-kc-text-muted">
          {item.type}
        </span>
        <span className="text-base font-semibold text-kc-charcoal">{item.title}</span>
        {item.description && (
          <span className="text-sm text-kc-text-muted line-clamp-2">{item.description}</span>
        )}
      </button>
      {item.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {item.tags.map((t) => (
            <li key={t} className="rounded-full bg-kc-warm-gray px-2 py-0.5 text-xs text-kc-text">{t}</li>
          ))}
        </ul>
      )}
      {item.openCount > 0 && (
        <p className="mt-1 text-xs text-kc-text-muted">
          {item.openCount} open{item.openCount === 1 ? "" : "s"}
          {item.lastOpenedAt && ` · last ${formatDistanceToNowStrict(new Date(item.lastOpenedAt))} ago`}
        </p>
      )}
    </li>
  )
}
```

- [ ] **Step 3: Implement `arsenal-drawer.tsx`**

```tsx
"use client"

import { useState } from "react"
import type { ArsenalItem } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Copy, Mail } from "lucide-react"

const ORIGIN = typeof window === "undefined" ? "" : window.location.origin

export function ArsenalDrawer({
  item,
  onClose,
  stats,
}: {
  item: ArsenalItem | null
  onClose: () => void
  stats: { openCount: number; lastOpenedAt: string | null; linkSlug: string | null } | null
}) {
  const [busy, setBusy] = useState(false)

  if (!item) return null

  async function createAndCopy() {
    setBusy(true)
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-create-link`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item!.id, prospectEmail: null }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { slug } = await res.json()
      await navigator.clipboard.writeText(`${ORIGIN}/c/${slug}`)
      alert("Short link copied")
    } catch (e) { alert(String(e)) } finally { setBusy(false) }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-[420px] border-l border-kc-warm-gray-dark bg-white p-6 shadow-xl">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-kc-text-muted">{item.type}</p>
          <h3 className="text-lg font-semibold text-kc-charcoal">{item.title}</h3>
        </div>
        <button aria-label="Close" onClick={onClose} className="text-kc-text-muted">×</button>
      </header>

      {item.description && <p className="mb-4 text-sm text-kc-text">{item.description}</p>}

      <a href={item.url} target="_blank" rel="noreferrer" className="mb-6 block truncate text-sm text-kc-gold underline">
        {item.url}
      </a>

      <div className="flex gap-2">
        <Button onClick={createAndCopy} disabled={busy} className="gap-2">
          <Copy className="h-4 w-4" /> Copy trackable link
        </Button>
        <Button variant="secondary" className="gap-2" disabled={busy}>
          <Mail className="h-4 w-4" /> Send via Gmail
        </Button>
      </div>

      {stats && stats.openCount > 0 && (
        <section className="mt-6 rounded-lg bg-kc-warm-gray p-4 text-sm">
          <p className="font-medium text-kc-charcoal">{stats.openCount} opens</p>
          {stats.lastOpenedAt && (
            <p className="text-kc-text-muted">Last open: {new Date(stats.lastOpenedAt).toLocaleString()}</p>
          )}
        </section>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/arsenal/rep-arsenal-client.tsx frontend/src/components/arsenal/arsenal-tile.tsx frontend/src/components/arsenal/arsenal-drawer.tsx
git commit -m "feat(arsenal): add rep Arsenal client with tiles and drawer"
```

### Task 6.3: Add Arsenal link to app nav

**Files:**
- Modify: `frontend/src/components/layout/app-nav.tsx`

- [ ] **Step 1: Insert nav entry between Pipeline and Settings**

Locate the `NAV_ITEMS` (or equivalent) array and add:

```tsx
{ label: "Arsenal", href: "/arsenal", icon: Library },
```

Import `Library` from `lucide-react` at the top of the file.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/layout/app-nav.tsx
git commit -m "feat(arsenal): add Arsenal entry to app nav"
```

---

## Phase 7: Draft drawer integration — prefill link + Drive attachment toggle

### Task 7.1: Extend draft drawer props

**Files:**
- Modify: `frontend/src/components/drafting/draft-drawer.tsx`

- [ ] **Step 1: Add prefill and attachment props**

Near the top of the component, add to its prop type:

```tsx
type DraftDrawerProps = {
  // ...existing props
  prefillBody?: string
  extraAttachments?: Array<{ driveFileId?: string; bucketPath?: string; filename?: string }>
}
```

Then, in the effect that initializes the editor (or in the body-state init), use `prefillBody` if present to seed the editor content.

Where the body is sent to `create-gmail-draft`, include `extraAttachments` in the request payload.

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/drafting/draft-drawer.tsx
git commit -m "feat(arsenal): draft drawer accepts prefillBody and extraAttachments"
```

### Task 7.2: Wire "Send via Gmail" in Arsenal drawer

**Files:**
- Modify: `frontend/src/components/arsenal/arsenal-drawer.tsx`

- [ ] **Step 1: Add contact picker and send flow**

Within `ArsenalDrawer`, add a small contact-search field that hits a new endpoint or reuses an existing contact search. For v1, fall back to a plain `<input type="email">` where the rep types the prospect email manually.

On "Send via Gmail":
1. Call `arsenal-create-link` with `{ itemId, prospectEmail }`.
2. Build body text: `"Hi <firstName>,\n\n<short intro>\n\n<shortUrl>\n\n<rep signoff>"`.
3. Determine attachment — if the item has `storage_path`, use `{ bucketPath: item.storage_path, filename: item.title }`. If the URL is a Drive link and the user ticks "Attach file" toggle, extract the fileId and send `{ driveFileId }`.
4. Open the existing draft drawer via your existing invocation pattern, passing `prefillBody` and `extraAttachments`.

```tsx
// Simplified send flow inside ArsenalDrawer
async function sendViaGmail(prospectEmail: string, attachDrive: boolean) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const linkRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/arsenal-create-link`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemId: item!.id, prospectEmail }),
  })
  const { slug } = await linkRes.json()
  const shortUrl = `${ORIGIN}/c/${slug}`

  const extras = []
  if (item!.storage_path) {
    extras.push({ bucketPath: item!.storage_path, filename: item!.title })
  } else if (attachDrive && item!.url.includes("drive.google.com")) {
    const m = item!.url.match(/\/(?:d|file\/d)\/([a-zA-Z0-9_-]+)/)
    if (m) extras.push({ driveFileId: m[1] })
  }

  // openDraftDrawer is whatever function opens the existing draft drawer in your app
  openDraftDrawer({
    toEmail: prospectEmail,
    prefillBody: `Hi,\n\nI thought this might be useful:\n\n${shortUrl}\n\nLet me know what you think.`,
    extraAttachments: extras,
  })
}
```

Integrate `openDraftDrawer` via whatever shared context/prop pattern the app already uses (check `draft-trigger.tsx` for the pattern).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/arsenal/arsenal-drawer.tsx
git commit -m "feat(arsenal): wire Send via Gmail in Arsenal drawer"
```

---

## Phase 8: Metabase CSV snapshot pipeline

### Task 8.1: Extend `ingest-metabase` to store CSV snapshots

**Files:**
- Modify: `supabase/functions/ingest-metabase/index.ts`

- [ ] **Step 1: After successful parse, upload raw CSV to Storage**

Inside the existing handler, after the CSV is parsed and upserts succeed, add:

```ts
const now = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
const path = `global/metabase/${reportSlug}-${now}.csv`
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const encoded = new TextEncoder().encode(rawCsvText)
await admin.storage.from("arsenal").upload(path, encoded, {
  contentType: "text/csv",
  upsert: true,
})

const { data: { publicUrl } } = admin.storage.from("arsenal").getPublicUrl(path)

// Upsert arsenal_items row of type='report'
await admin.from("arsenal_items").upsert({
  visibility: "global",
  type: "report",
  title: `${reportName} (${now})`,
  description: `Metabase snapshot refreshed ${now}`,
  url: publicUrl,
  storage_path: path,
  tags: ["metabase", reportSlug],
  created_by: "system@keychain.com",
}, { onConflict: "url" })
```

(`reportName`, `reportSlug`, `rawCsvText` are fields you will pull from the existing Metabase ingest code — adapt names to match.)

- [ ] **Step 2: Redeploy**

Use `mcp__supabase__deploy_edge_function` with name `ingest-metabase`.

- [ ] **Step 3: Smoke-test**

Trigger a Metabase ingest (existing admin flow). Verify:
1. A CSV lands at `arsenal/global/metabase/<slug>-<date>.csv` (via `mcp__supabase__execute_sql`: `select name from storage.objects where bucket_id='arsenal' order by created_at desc limit 5`).
2. A new `arsenal_items` row of `type='report'` exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ingest-metabase/index.ts
git commit -m "feat(arsenal): save Metabase snapshots to arsenal Storage bucket"
```

---

## Phase 9: Seed, QA, docs

### Task 9.1: Seed a small global catalog

**Files:**
- Create: `supabase/migrations/014_arsenal_seed.sql` (or a one-off SQL snippet — seeds are optional)

- [ ] **Step 1: Insert 5 demo rows for local/dev only**

```sql
insert into arsenal_items (visibility, type, title, description, url, tags, created_by) values
  ('global', 'reference', 'Positioning one-pager', 'Who we are, who we serve, what we don''t do.', 'https://docs.google.com/document/d/PLACEHOLDER_DOC', '{"positioning","onboarding"}', 'admin@keychain.com'),
  ('global', 'reference', 'Objection handling matrix', 'Top 12 objections and the one-line response that works best.', 'https://docs.google.com/document/d/PLACEHOLDER_MATRIX', '{"objections"}', 'admin@keychain.com'),
  ('global', 'collateral', 'Q1 customer case study', 'How [Brand] used Keychain to consolidate 11 vendors.', 'https://drive.google.com/file/d/PLACEHOLDER_CASE', '{"case-study","apparel"}', 'admin@keychain.com'),
  ('global', 'collateral', 'Platform overview deck', 'The 20-slide sales narrative. Don''t edit — copy to a fresh deck to customize.', 'https://docs.google.com/presentation/d/PLACEHOLDER_DECK', '{"deck"}', 'admin@keychain.com'),
  ('global', 'report', 'Industry benchmarks Q1 2026', 'Public-facing PDF with industry benchmarks.', 'https://example.com/benchmarks.pdf', '{"benchmarks"}', 'admin@keychain.com')
on conflict do nothing;
```

- [ ] **Step 2: Apply via Supabase MCP** (optional; safe to skip in production)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/014_arsenal_seed.sql
git commit -m "chore(arsenal): seed demo library items"
```

### Task 9.2: Update documentation

**Files:**
- Modify: `docs/database.md`
- Modify: `docs/edge-functions.md`
- Modify: `docs/frontend.md`

- [ ] **Step 1: Add Arsenal tables to `docs/database.md`**

Append a section describing the three new tables, their relationships, and RLS policies. Follow existing patterns in the file (table name as H3, columns as a markdown table).

- [ ] **Step 2: Add Edge Functions to `docs/edge-functions.md`**

One subsection per new function: `arsenal-create-link`, `arsenal-stats`, `arsenal-upload-url`. Mention the modifications to `create-gmail-draft` and `ingest-metabase`.

- [ ] **Step 3: Add routes to `docs/frontend.md`**

- `/arsenal` — rep-facing Library + My Content
- `/admin/arsenal` — admin curation
- `/c/[slug]` — public redirect (no auth, runs in Node runtime)

- [ ] **Step 4: Commit**

```bash
git add docs/database.md docs/edge-functions.md docs/frontend.md
git commit -m "docs(arsenal): document tables, functions, and routes"
```

### Task 9.3: End-to-end smoke test

- [ ] **Step 1: Admin flow**

Sign in as an admin, go to `/admin/arsenal`:
1. Add a reference item via "Paste URL" — verify it lands in the Reference tab.
2. Add a collateral item via "Upload PDF" — verify it uploads to Storage and appears in the Collateral tab.
3. Soft-delete one of the above — it should disappear from the Library.
4. Open `/arsenal` as the same user — items match what's left.

- [ ] **Step 2: Rep flow**

Sign in as a non-admin rep:
1. `/arsenal` shows the 3 tabs with admin-curated content.
2. "Copy trackable link" on a tile → creates a link, copies `<origin>/c/<slug>`.
3. Open the copied URL in an incognito browser → 302 redirects to the target URL.
4. Refresh `/arsenal` — the tile shows "1 open".
5. Repeat the open with a `Slackbot-LinkExpanding` UA — open count should NOT increment (bot filter).
6. Add a personal Drive link to My Content — verify it appears in the My Content section only.

- [ ] **Step 3: Draft drawer flow**

From the Arsenal drawer for a collateral item:
1. Click "Send via Gmail", enter a prospect email, confirm the attachment toggle.
2. Gmail draft appears with the short link in the body and the attachment (PDF or Drive-exported PDF) attached.
3. Open the short link → opens the content, increments the count.

- [ ] **Step 4: Report smoke test**

Trigger a Metabase ingest. Verify a new `arsenal_items` row of `type='report'` appears, and the linked CSV downloads cleanly when opened from the redirect URL.

### Task 9.4: Deploy and final commit

- [ ] **Step 1: Deploy frontend**

```bash
cd frontend && vercel --prod --yes
```

- [ ] **Step 2: Final commit bundling any last polish**

```bash
git add -A
git commit -m "chore(arsenal): final polish and QA fixes"
git push origin <feature-branch>
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main --title "Arsenal — Sales Enablement Library + Trackable Collateral" \
  --body "Implements the spec at docs/superpowers/specs/2026-04-16-arsenal-sales-enablement-design.md"
```

---

## Dependencies between phases

- Phase 1 blocks everything else (schema is foundation).
- Phase 2 depends only on Phase 1.
- Phase 3 depends on Phase 1.
- Phase 4 can run in parallel with Phase 2 and 3.
- Phases 5 and 6 depend on Phases 1 + 3.
- Phase 7 depends on Phases 4 + 6.
- Phase 8 depends on Phase 1.
- Phase 9 runs after everything else.

Can be split across multiple PRs if desired — natural split points are Phase 4 (OAuth scope change), Phase 6 (reps get the page), and Phase 7 (send flow goes live).

---

## Self-Review Checklist

- Per-prospect tracking (spec #3): implemented via `collateral_links.prospect_email`, consumed by `arsenal-create-link`, tracked through to the redirect handler.
- Soft-disable on admin delete (spec #6): implemented in `AdminItemRow` (`active=false` update) and honored by redirect handler (410 page).
- Insert-all + read-time bot filter (spec #4): redirect inserts unconditionally; `arsenal-stats` filters via `_shared/bot-filter.ts`.
- PDF hosting dual-mode (spec #1): `AddItemDialog` has URL and Upload tabs; Storage path stored in `arsenal_items.storage_path`.
- Metabase snapshots (spec #2): `ingest-metabase` extended in Task 8.1.
- Drive scope (spec #5): `drive.readonly` added in Task 4.1; `_shared/drive-download.ts` fetches binary + exports Google-native formats; `create-gmail-draft` accepts `driveFileId`.
- No placeholders remaining. All code blocks show actual implementation.
