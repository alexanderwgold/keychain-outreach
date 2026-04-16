# Arsenal — Sales Enablement Library & Trackable Collateral — Design Spec

**Date:** 2026-04-16
**Status:** Draft — pending approval

---

## Overview

A new page `/arsenal` that gives reps a single place to:

1. **Review** internal reference material during outreach (positioning, talking points, objection handling, product specs).
2. **Send** external collateral to prospects (decks, one-pagers, case studies, Metabase reports).
3. **Curate** their own private collateral in a personal "My Content" section.

Every piece of collateral a rep sends generates a **trackable short link** so reps can see which prospects actually open what, and which pieces of content convert.

Content sources: Google Drive URLs (existing Drive folder), standalone PDFs (admin-uploaded), Metabase reports (already ingested via `ingest-metabase`).

---

## User stories

### Rep
- As a rep, I can browse admin-curated reference material so I know how to position our product.
- As a rep, I can browse admin-curated collateral and send any piece as a trackable link in a Gmail draft.
- As a rep, I can see open counts and last-opened timestamp for each link I've sent.
- As a rep, I can save my own Drive links / PDFs to "My Content" and reuse them across prospects.

### Admin
- As an admin, I can add, edit, and remove items in the shared Library (three types: reference, collateral, report).
- As an admin, I can tag items so reps can filter.
- As an admin, I can see aggregated open stats across the whole team for each shared item.

### Prospect
- As a prospect, clicking a link opens the collateral directly (Drive preview or PDF). No login, no friction.

---

## Data model

### Table: `arsenal_items`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, default gen_random_uuid() | |
| visibility | text | not null, check in (`global`, `private`) | Global = admin-curated shared; Private = rep's My Content |
| owner_email | text | nullable, FK to rep_tokens(rep_email) | Required when visibility = `private`, null when `global` |
| type | text | not null, check in (`reference`, `collateral`, `report`) | Governs which shelf/tab the tile renders in |
| title | text | not null | Display name |
| description | text | default `''` | One-liner under the title |
| url | text | not null | Drive URL, PDF URL (Supabase Storage or external), or Metabase report link |
| thumbnail_url | text | nullable | For tiles that show a preview image |
| tags | text[] | default `'{}'` | Filterable chips per shelf |
| sort_order | int | default 0 | Admin drag-reorder for global items |
| created_by | text | not null | Rep email of creator |
| created_at | timestamptz | not null, default now() | |
| updated_at | timestamptz | not null, default now() | `update_updated_at` trigger |

Indexes:
- `(visibility, type)` composite — primary list query
- `(owner_email, type)` — "My Content" filter
- GIN on `tags` — tag filtering

### Table: `collateral_links`

One short-link per (rep, item) pair. Reusable — sending the same item to a second prospect reuses the same slug unless the rep explicitly rotates it.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, default gen_random_uuid() | |
| slug | text | unique, not null | 8-char base62, e.g. `k3N9qP2w`. Generated at insert. |
| item_id | uuid | FK to arsenal_items, not null | |
| rep_email | text | FK to rep_tokens, not null | |
| active | bool | not null, default true | Soft-disable without deleting (preserves historical events) |
| created_at | timestamptz | not null, default now() | |

Unique constraint: `(item_id, rep_email, active)` where `active = true` — enforces one active link per (rep, item).

### Table: `collateral_events`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | bigserial | PK | High-volume, int PK is fine |
| link_id | uuid | FK to collateral_links, not null | |
| event_type | text | not null, check in (`opened`, `downloaded`) | `downloaded` only if we proxy the file; v1 = opens only |
| user_agent | text | nullable | Raw UA string for bot filtering post-hoc |
| ip_prefix | text | nullable | `/24` for IPv4, `/48` for IPv6 — privacy-preserving |
| referrer | text | nullable | |
| created_at | timestamptz | not null, default now() | |

Index: `(link_id, created_at desc)` — the "last opened + count" query on every arsenal tile.

---

## RLS policies

**`arsenal_items`**
- SELECT: `visibility = 'global' OR owner_email = auth.jwt()->>'email'`
- INSERT `visibility = 'global'`: only if `auth.jwt()->>'email'` in `ADMIN_EMAILS`
- INSERT `visibility = 'private'`: any authenticated rep, `owner_email` must equal their own email
- UPDATE/DELETE: admins on global, owners on their private

**`collateral_links`**
- SELECT: `rep_email = auth.jwt()->>'email'` OR admin (for team-wide stats)
- INSERT: `rep_email = auth.jwt()->>'email'`
- UPDATE: owner only

**`collateral_events`**
- SELECT: reps see events for their own links, admins see all
- INSERT: service role only — the redirect route inserts with service role key

---

## Edge Functions

### `arsenal-create-link`

**Method:** POST
**Auth:** Verifies rep JWT; admin client for DB writes
**Input:** `{ itemId: string }`
**Output:** `{ slug: string, url: string }` where `url` is the short URL `https://keychain-outreach.vercel.app/c/{slug}`

Flow:
1. Verify the item exists and the rep can access it (`visibility = 'global'` OR they own it).
2. Look up existing active `collateral_links` row for `(itemId, repEmail)`. If found, return it.
3. Otherwise generate an 8-char base62 slug. Retry on collision up to 3× (astronomically unlikely).
4. Insert row, return.

### `arsenal-stats`

**Method:** GET
**Auth:** Verifies rep JWT
**Input:** `?itemIds=uuid1,uuid2,...`
**Output:** `{ [itemId]: { openCount: number, lastOpenedAt: string | null, linkSlug: string | null } }`

Single query joining `collateral_links` and `collateral_events` scoped to the requesting rep. Returns stats for the tiles the rep can currently see.

### Route handler: `/c/[slug]/route.ts` (Next.js, NOT an Edge Function)

This lives in the frontend Next.js app, not in Supabase Edge Functions, because it needs to issue an HTTP redirect and Vercel handles that better than a round-trip to Supabase.

Flow:
1. Look up `collateral_links` by slug (service role, bypass RLS).
2. If not found or `active = false`, return 404.
3. Fire-and-forget insert into `collateral_events` with `event_type = 'opened'`, bot-filtered UA, `/24`-truncated IP, referrer.
4. Join to `arsenal_items` to get the real URL. Return HTTP 302 redirect.

Runs on Fluid Compute (Node runtime) so it can use the Supabase admin client.

---

## Frontend

### Route: `/arsenal`

Two stacked sections:

**Shared Library** (top)
- Tab nav: Reference · Collateral · Reports
- Tag filter row (dynamic from `arsenal_items.tags`)
- Grid of tiles using `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`
- Tile: title, description, type chip, tag pills, open-count badge (if rep has sent it)

**My Content** (bottom)
- "Add item" CTA (paste Drive URL or upload PDF)
- Same tile layout, no type restriction
- Owner-only

### Tile interactions

- **Click tile** → opens right-side drawer with:
  - Larger preview (Drive embed for Docs/Slides, `<iframe>` for PDFs, thumbnail for reports)
  - Full description
  - Tags
  - **Send via Gmail** button → opens the existing draft drawer, pre-populated with short link in the body (creates `collateral_links` row first)
  - **Copy link** button → creates link and puts the short URL on clipboard
  - **Attach to draft** toggle → if on, attaches the source file directly in addition to the link (file goes through existing `create-gmail-draft` MIME builder)
  - Stats block: open count, last-opened date, list of recent events (with IP prefix + UA class)

### Route: `/arsenal/admin` (admin-only)

Same layout but shows global items only, with inline edit, drag-reorder, delete, and bulk tag management.

### Navigation

Add "Arsenal" entry to `AppNav` between Pipeline and Settings.

---

## Send flows

### Option A: Trackable link only (recommended default)

1. Rep clicks **Send via Gmail** on a tile.
2. Frontend calls `arsenal-create-link` → receives slug.
3. Existing draft drawer opens with the short URL pre-inserted at the cursor in the email body.
4. Claude generates the surrounding copy that references the link contextually (prompt injection: "The rep is sending this specific piece of collateral: {title}. Include the link {shortUrl} naturally in the message.").
5. Rep reviews, edits, hits "Save draft" (or whatever existing button triggers `create-gmail-draft`).

### Option B: Link + direct attachment (toggle on the tile)

Same as A, but the file itself is also attached via the existing MIME builder. Useful when the prospect's email client blocks Drive links or when the rep wants to guarantee delivery. Tracking still works on the link if the prospect clicks it.

### Option C: Attachment only (legacy path)

Not exposed in UI v1 — trackable link is always created alongside. If we discover demand for silent sends, add a setting later.

---

## UI design direction

- Three horizontal shelves with distinct tile treatments per type (reference = calm, collateral = action-oriented, reports = data-forward).
- Tiles use the existing "Warm Precision" palette. No new color ramp.
- Stats badges use subdued numbers — not vanity metrics, not loud.
- Drawer slides from the right (consistent with draft drawer pattern).
- Font: Inter throughout, matching rest of app.

Detailed component breakdown will live in `docs/frontend.md` once implementation starts.

---

## Open questions

1. **PDF hosting:** Do admin-uploaded PDFs go in Supabase Storage (new bucket), or do admins upload to Drive and paste the link? Simpler = Drive links only. Faster-serving = Storage.
2. **Metabase report handling:** Are reports live-linked (every view hits Metabase) or exported snapshots (PDF per refresh, stored in Storage)? Latter is more secure for share-outs.
3. **Prospect identity:** v1 tracks opens, not prospects. Do we want per-prospect links in v2 (append `?p=prospectId` and associate the event)?
4. **Bot filtering:** Gmail's link preview fetches and Slack's Unfurler will generate fake opens. Should we filter on UA in the redirect handler, or filter at read-time on the stats query? Suggest read-time filter — keeps the write path fast.
5. **Attachment mechanics for Drive-hosted files:** Does `create-gmail-draft` already handle Drive-hosted attachments, or only Supabase Storage? If Drive-only, we need a fetch step (download, attach).
6. **Link hygiene:** When an admin deletes a global item, do we hard-delete `collateral_links` (breaks sent emails) or soft-disable and show "this content is no longer available" at the redirect? Soft-disable is the polite default.

---

## Out of scope for v1

- Per-prospect link attribution
- Link expiration / password protection
- Custom branding on the redirect page (for now: direct 302)
- Analytics dashboard beyond the per-tile stats block
- Approval workflow for rep-added items (reps can freely add to My Content)
- A/B testing which collateral converts best

---

## Migration + implementation plan (rough)

1. **Migration** `011_arsenal.sql` — three tables, RLS, indexes, trigger.
2. **Edge Function** `arsenal-create-link` + `arsenal-stats`.
3. **Route handler** `/c/[slug]/route.ts` with service-role Supabase client.
4. **Frontend pages** `/arsenal` and `/arsenal/admin`.
5. **Components** `ArsenalTile`, `ArsenalDrawer`, `ArsenalShelf`, `MyContentUploader`.
6. **Integration with existing draft drawer** — pass `prefillBody` with short URL.
7. **Seed data** — 5-10 admin items so the page isn't empty on first load.

Estimated effort: 2-3 days for a focused single-dev build.

---

## Dependencies

- Existing: `rep_tokens`, `create-gmail-draft`, draft drawer, admin route protection, ADMIN_EMAILS.
- New: nothing external. No new OAuth scopes needed (Drive URLs are click-through, not API-read).
