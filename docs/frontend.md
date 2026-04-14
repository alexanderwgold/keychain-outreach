# Frontend Structure & Routes

React app hosted on Vercel. Use `/deploy` to deploy.

---

## Routes

| Route | Who sees it | Purpose |
|-------|-------------|---------|
| `/` | All | Google OAuth login page |
| `/dashboard` | Reps | Rep view — contacts, today's actions, draft email, enhance with research |
| `/admin` | Founders | Team activity dashboard |
| `/admin/upload` | Founders | CSV import |

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

## Auth integration

- Login page renders a "Sign in with Google" button that redirects to the Google OAuth URL
- After the `auth-callback` Edge Function completes, it redirects to `/dashboard`
- Store the Supabase session client-side (Supabase JS client handles this automatically)
- Admin routes check if the authenticated user's email is in a hardcoded founders list or an `admins` table (TBD)
