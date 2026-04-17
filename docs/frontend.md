# Frontend Structure & Routes

React app hosted on Vercel. Use `/deploy` to deploy.

---

## Routes

| Route | Who sees it | Purpose |
|-------|-------------|---------|
| `/` | All | Google OAuth login page |
| `/dashboard` | Reps | Rep view — contacts, today's actions, draft email, enhance with research |
| `/arsenal` | Reps | Shared Library + private My Content — trackable collateral & reports |
| `/admin` | Founders | Team activity dashboard |
| `/admin/upload` | Founders | CSV import |
| `/admin/arsenal` | Founders | Admin curator for the global Arsenal library |
| `/c/[slug]` | Public | Trackable collateral redirect; logs opens and 302s to the asset |

Auth guard: redirect unauthenticated users to `/`. Redirect authenticated non-admins away from `/admin/*`.

---

## Rep dashboard (`/dashboard`)

Two panels:

**My Contacts table:**
- Columns: Contact name, Company, Title, Opp Stage, Days Since Last Touch (color-coded: green < threshold, yellow = at threshold, red = overdue), Last Activity, Next Suggested Action
- Per-row actions: "Draft Email" button (calls AI drafting, renders variants inline), "Enhance with Research" button (appears on any existing draft)
- Data source: `opportunities` joined to `contacts` via `opportunity_contacts`, joined to `activity_log` for last-touch calculation, joined to `cadence_rules` for threshold comparison

**Today's Actions panel:**
- Contacts due for follow-up (sorted by most overdue)
- Drafts awaiting send (from Gmail, surfaced by daily scan)
- Upcoming meetings this week (from `upcoming_meetings`)

**Realtime:** Use Supabase realtime subscriptions on `activity_log` and `upcoming_meetings` so the dashboard updates live when the scan runs.

---

## Founder/Admin dashboard (`/admin`)

**Team Dashboard:**
- Activity volume by rep (emails sent, meetings held, replies received) — time range selector: 7/14/30 days
- Coverage heat map: % of assigned contacts touched in selected period, by rep
- Stale contacts: total contacts past cadence threshold, broken down by rep
- Pipeline movement: contacts/opportunities that advanced stages this week
- Top-performing outreach: copy variants correlated with replies (based on `activity_log` `reply_received` events)

**Filters:** by rep, by stage, by date range, by account

---

## CSV upload (`/admin/upload`)

Simple file input that POSTs the CSV to the `csv-import` Edge Function (see `docs/salesforce-sync.md`). Shows import summary on completion: rows processed, opportunities upserted, contacts upserted, new rep mappings needed (reps found in CSV whose `sf_display_name` has no entry in `rep_mapping`).

---

## Rep Arsenal (`/arsenal`)

Server component. Calls `getRepArsenalItems(user.email)` and passes `{ global, mine, itemIds, repEmail }` to `<RepArsenalClient />`. The client hydrates open-count / last-opened stats from the `arsenal-stats` Edge Function.

**Tabs:**
- **Shared Library** — all `visibility = 'global'` items, split by `type` into Reference, Collateral, Reports.
- **My Content** — the rep's `visibility = 'private'` items; full create/edit/delete via Storage upload or URL paste.

**Reports tab** shows internal Metabase snapshots (`type = 'report'`). Reps can open and view these, but the trackable-link and "Send via Gmail" actions are replaced with a muted note — reports aren't meant to leave the building.

---

## Admin Arsenal (`/admin/arsenal`)

Admin-only library curator under the `(admin)` route group. Server component fetches via `getGlobalArsenalItems()` and renders `<AdminArsenalClient />`.

Full CRUD on `visibility = 'global'` items:
- Add via URL paste (reference / external collateral) or Storage upload (calls `arsenal-upload-url` with `scope: 'global'` then PUTs to the signed URL).
- Edit title / description / tags / thumbnail.
- Soft-delete (`active = false`) — preserves historical `collateral_links` so already-sent short URLs continue to resolve until the admin explicitly disables them.

Reports tab is visible to admins for ops visibility into the Metabase snapshots written by `ingest-metabase`.

---

## Collateral redirect (`/c/[slug]`)

Public redirect handler. Node runtime (`export const runtime = "nodejs"`) so it can use the Supabase service-role client. **Excluded from the auth middleware** via the `proxy.ts` matcher (`/c/` is in the negative-lookahead list), so it's reachable without a session.

**Flow:**
1. Look up the slug in `collateral_links` with `arsenal_items` joined.
2. If the link or item is missing / inactive, return **410 Gone** with a friendly HTML page ("This content is no longer available").
3. Insert a `collateral_events` row unconditionally — bot filtering is applied at read time in `arsenal-stats`, not here. Captures truncated IP prefix (`/24` IPv4, `/48` IPv6), user-agent, and referrer.
4. If `arsenal_items.storage_path` is set, generate a 5-minute signed URL via `createSignedUrl(path, 300)`. Otherwise use `arsenal_items.url`.
5. **302** redirect with `cache-control: no-store`.

---

## Auth integration

- Login page renders a "Sign in with Google" button that redirects to the Google OAuth URL
- After the `auth-callback` Edge Function completes, it redirects to `/dashboard`
- Store the Supabase session client-side (Supabase JS client handles this automatically)
- Admin routes check if the authenticated user's email is in a hardcoded founders list or an `admins` table (TBD)
