# Day 2 Frontend Build Plan: Rep Dashboard & App Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade Next.js frontend with a daily briefing dashboard for reps, a full pipeline view, an AI email drafting system with rich HTML editor, and a founder admin dashboard — all themed to Keychain's brand identity.

**Architecture:** Next.js 16 App Router with server components by default, client components only where interactivity requires it. Supabase JS client for auth, data fetching, and realtime subscriptions. Route groups separate public (login) from authenticated (app) from admin views. Side drawer + pop-out window for email drafting with TipTap rich text editor.

**Tech Stack:** Next.js 16.2, React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui (base-nova), Supabase JS (@supabase/ssr for auth), Sentry (@sentry/nextjs v10 — error tracking, performance, session replay, logs), TipTap (rich text), Lucide React (icons)

---

## Design Direction: "Warm Precision"

Blend of Bloomberg's information density with calm clarity, grounded in Keychain's signature gold.

### Brand Palette (CSS custom properties)

| Token | Value | Usage |
|-------|-------|-------|
| `--kc-gold` | `#F5C518` | Primary CTA, active states, brand accent |
| `--kc-gold-light` | `#FFF3C4` | Subtle highlights, selected rows |
| `--kc-gold-dark` | `#D4A012` | Hover states, pressed buttons |
| `--kc-charcoal` | `#1C1C1E` | Nav bar, headings, high-contrast text |
| `--kc-warm-white` | `#FAFAF8` | Page background |
| `--kc-warm-gray` | `#F0EEEB` | Card backgrounds, secondary surfaces |
| `--kc-warm-gray-dark` | `#E0DDD8` | Borders, dividers |
| `--kc-text` | `#2C2C2E` | Body text |
| `--kc-text-muted` | `#8E8E93` | Secondary text, timestamps |
| `--kc-success` | `#34C759` | Cadence healthy (green) |
| `--kc-warning` | `#FF9500` | Cadence at threshold (amber) |
| `--kc-danger` | `#FF3B30` | Cadence overdue (red) |

### Typography

- **Display/Headings:** DM Sans (bold, characterful but highly legible)
- **Body:** Inter (clean readability at small sizes — used sparingly as body only, not as a design element)
- **Mono/Data:** JetBrains Mono (for numbers, stats, timestamps — Bloomberg nod)

### Key Design Principles

1. **Gold is earned** — use Keychain gold only for primary actions and active states. Everything else is neutral. This makes gold pop when it appears.
2. **Numbers are first-class** — stats, days-since-touch, counts rendered in mono with extra weight. Data should feel authoritative.
3. **Urgency is color, not clutter** — green/amber/red dots and badges are the only loud visual signals. The rest of the interface stays calm.
4. **Generous but not wasteful** — enough whitespace to breathe, but information density is higher than a typical SaaS dashboard. Reps should see 8-12 items without scrolling.

---

## Route Structure

```
frontend/src/app/
  layout.tsx                    — root layout (fonts, providers, metadata)
  globals.css                   — Keychain theme tokens + shadcn overrides
  page.tsx                      — login page (public)
  (app)/
    layout.tsx                  — authenticated shell (nav bar, sidebar)
    dashboard/
      page.tsx                  — daily briefing (rep default view)
      loading.tsx               — skeleton loader
      error.tsx                 — error boundary
    pipeline/
      page.tsx                  — full opportunities/contacts table
      loading.tsx
      error.tsx
  (admin)/
    layout.tsx                  — admin shell (admin nav)
    admin/
      page.tsx                  — founder dashboard
      loading.tsx
      error.tsx
      upload/
        page.tsx                — CSV upload
  api/
    auth/
      callback/
        route.ts                — Google OAuth callback handler
```

## Sentry Integration (already installed)

`@sentry/nextjs` v10.48 is configured in the project. Org: `alexander-gold`, project: `javascript-nextjs`.

**Existing config files (do NOT recreate — already committed):**
- `next.config.ts` — `withSentryConfig` wrapper, tunnel route `/monitoring`, source maps
- `src/instrumentation.ts` — server/edge init via `register()`, `onRequestError` capture
- `src/instrumentation-client.ts` — client init with session replay, router transition tracking
- `src/sentry.server.config.ts` — server-side DSN, PII, local variables, logs
- `src/sentry.edge.config.ts` — edge runtime DSN, PII, logs
- `.env.sentry-build-plugin` — auth token for source map uploads

**Where Sentry must be woven into new code:**

| Touchpoint | What to do | Stage |
|------------|-----------|-------|
| `global-error.tsx` | Root error boundary — calls `Sentry.captureException(error)` on mount, renders branded error page | S1 |
| Every `error.tsx` | Call `Sentry.captureException(error)` in a `useEffect` so unhandled route errors are reported | S1 |
| Auth callback (`route.ts`) | Wrap in `Sentry.startSpan` for OAuth flow tracing; capture auth failures with `Sentry.captureException` | S2 |
| `Sentry.setUser()` | Call after successful login with `{ email, id }` so all subsequent errors are tagged to the rep | S2 |
| `Sentry.setUser(null)` | Call on sign-out to clear user context | S2 |
| Data fetch hooks | Wrap Supabase queries in `Sentry.startSpan({ name, op: "db.query" })` for performance tracing | S3, S4 |
| AI drafting calls | `Sentry.startSpan({ name: "ai.draft", op: "ai.run" })` around Claude API calls; capture failures | S5 |
| CSV upload | `Sentry.startSpan({ name: "csv.upload" })` around the upload; `Sentry.captureException` on failure | S7 |
| Realtime subscriptions | `Sentry.captureException` on subscription errors | S8 |
| `Sentry.logger.*` | Use structured logs (`Sentry.logger.info`, `.warn`, `.error`) for key operations: auth events, draft generation, CSV import results, cadence alerts | All |

## File Structure (all files this plan produces)

```
frontend/src/
  app/
    globals.css                         — Keychain design tokens
    global-error.tsx                    — root Sentry error boundary (new)
    layout.tsx                          — root layout (fonts, metadata)
    page.tsx                            — login page
    (app)/
      layout.tsx                        — authenticated app shell
      dashboard/
        page.tsx                        — daily briefing
        loading.tsx                     — briefing skeleton
        error.tsx                       — briefing error boundary (Sentry-wired)
      pipeline/
        page.tsx                        — full pipeline table
        loading.tsx
        error.tsx                       — pipeline error boundary (Sentry-wired)
    (admin)/
      layout.tsx                        — admin layout with nav
      admin/
        page.tsx                        — founder dashboard
        loading.tsx
        error.tsx                       — admin error boundary (Sentry-wired)
        upload/
          page.tsx                      — CSV upload page
    api/
      auth/
        callback/
          route.ts                      — OAuth callback (Sentry-traced)
  components/
    layout/
      app-nav.tsx                       — top navigation bar
      app-sidebar.tsx                   — collapsible sidebar
      user-menu.tsx                     — avatar + dropdown (Sentry sign-out)
      sparkle-icon.tsx                  — Keychain sparkle brand motif
    dashboard/
      briefing-header.tsx               — greeting + summary stats
      action-card.tsx                   — single action item card
      overdue-contacts-list.tsx         — overdue contacts section
      pending-drafts-list.tsx           — unsent drafts section
      upcoming-meetings-list.tsx        — this week's meetings
    pipeline/
      pipeline-table.tsx                — main opportunities table
      pipeline-row.tsx                  — single opportunity row
      pipeline-filters.tsx              — stage/search/status filters
      stage-badge.tsx                   — colored stage pill
      urgency-dot.tsx                   — green/amber/red indicator
      contact-cell.tsx                  — contact name + title inline
    drafting/
      draft-drawer.tsx                  — side drawer container
      draft-variants.tsx                — 2-3 AI variant cards
      email-editor.tsx                  — TipTap rich text editor
      popout-composer.tsx               — full email composer (new window)
      tracking-pixel.tsx                — pixel injection utility
      research-button.tsx               — "Enhance with Research" CTA
    admin/
      activity-chart.tsx                — emails/meetings/replies by rep
      coverage-heatmap.tsx              — % contacts touched by rep
      stale-contacts-panel.tsx          — overdue contacts by rep
      pipeline-movement.tsx             — stage progression this week
      admin-filters.tsx                 — rep/stage/date/account filters
    auth/
      google-login-button.tsx           — styled OAuth button
      auth-guard.tsx                    — redirect if unauthenticated
  lib/
    supabase/
      client.ts                         — browser Supabase client
      server.ts                         — server component client
      proxy.ts                          — auth middleware helpers
    types.ts                            — shared TypeScript types (DB types)
    constants.ts                        — stage names, cadence thresholds, admin emails
    format.ts                           — date/number formatting utils
  hooks/
    use-user.ts                         — current user context (Sentry.setUser on mount)
    use-contacts.ts                     — fetch rep's contacts (Sentry-traced)
    use-activities.ts                   — fetch activity log (Sentry-traced)
    use-meetings.ts                     — fetch upcoming meetings (Sentry-traced)
    use-realtime.ts                     — Supabase realtime subscription (Sentry error capture)
  proxy.ts                              — Next.js 16 proxy (replaces middleware.ts)
```

---

## Staged Build Plan

### Sub-plans (execute in order)

| Stage | Plan | What it produces | Skill checkpoints |
|-------|------|-----------------|-------------------|
| 1 | [Design System & App Shell](2026-04-15-day2-S1-design-system.md) | Theme tokens, root layout, fonts, nav bar, route structure, auth guard | `vercel:nextjs`, `vercel:shadcn`, `vercel:next-best-practices`, `vercel:react-best-practices` |
| 2 | [Login & Auth Flow](2026-04-15-day2-S2-login-auth.md) | Google OAuth login page, callback handler, Supabase session, proxy.ts redirect | `vercel:auth`, `vercel:routing-middleware`, `vercel:nextjs` |
| 3 | [Daily Briefing Dashboard](2026-04-15-day2-S3-daily-briefing.md) | `/dashboard` with overdue contacts, pending drafts, upcoming meetings | `vercel:verification`, `vercel:react-best-practices`, `critique` |
| 4 | [Full Pipeline View](2026-04-15-day2-S4-pipeline.md) | `/pipeline` with sortable table, filters, stage badges, urgency dots | `vercel:next-best-practices`, `vercel:shadcn`, `vercel:react-best-practices` |
| 5 | [Email Drafting System](2026-04-15-day2-S5-drafting.md) | Side drawer, AI variant display, TipTap editor, pop-out composer, tracking pixel | `vercel:ai-sdk`, `vercel:ai-architect`, `vercel:react-best-practices` |
| 6 | [Founder Admin Dashboard](2026-04-15-day2-S6-admin.md) | `/admin` with activity charts, coverage heatmap, stale contacts, pipeline movement | `vercel:nextjs`, `vercel:react-best-practices`, `critique` |
| 7 | [CSV Upload](2026-04-15-day2-S7-csv-upload.md) | `/admin/upload` with file input, progress, import summary | `vercel:verification` |
| 8 | [Integration, Polish & Deploy](2026-04-15-day2-S8-polish.md) | Realtime subscriptions, animations, responsive pass, accessibility, production deploy | `vercel:deploy`, `vercel:performance-optimizer`, `audit`, `polish`, `animate` |

### Execution order and dependencies

```
S1 (design system) → S2 (auth) → S3 (briefing) → S4 (pipeline) → S5 (drafting)
                                                                       ↓
                                                   S6 (admin) → S7 (CSV upload)
                                                                       ↓
                                                              S8 (polish & deploy)
```

- **S1 before everything**: all stages use the theme and app shell
- **S2 before S3-S7**: authenticated routes need auth working
- **S3 and S4 can run in parallel** after S2 (independent views)
- **S5 depends on S3 or S4** (drawer opens from contact rows)
- **S6 and S7 can run in parallel** after S5 (admin is independent)
- **S8 is the final pass** after all features are built

### Review Checkpoints

After **each stage**, run these reviews before proceeding:

1. **`vercel:deploy`** — deploy preview to Vercel, verify it builds and renders
2. **`vercel:react-best-practices`** — run the TSX quality checklist on all new/modified components
3. **`code-reviewer`** — code review pass for bugs, security, naming, architecture
4. **`verification-before-completion`** — run build + type check + verify in browser before claiming done

After **Stage 1 + 2** (shell + auth complete):
- **`vercel:next-best-practices`** — file conventions, RSC boundaries, data patterns audit
- **`vercel:routing-middleware`** — verify proxy.ts auth redirect logic

After **Stage 3 + 4** (both views built):
- **`critique`** — UX evaluation of visual hierarchy, cognitive load, information architecture
- **`vercel:verification`** — full-story end-to-end verification (browser → API → data → response)

After **Stage 5** (drafting system):
- **`vercel:ai-architect`** — review AI integration patterns
- **`vercel:ai-sdk`** — verify AI SDK usage if applicable

After **Stage 8** (final):
- **`audit`** — full accessibility, performance, theming, responsive audit with P0-P3 severity
- **`vercel:performance-optimizer`** — Core Web Vitals, bundle size, rendering strategy review
- **`polish`** — final alignment, spacing, consistency micro-detail pass
- **`vercel:turbopack`** — verify build configuration and HMR performance

---

## Completion Checklist

Run these after all 8 stages complete:

- [ ] `npm run build` succeeds with zero errors and zero warnings
- [ ] All routes render: `/`, `/dashboard`, `/pipeline`, `/admin`, `/admin/upload`
- [ ] Login flow: Google OAuth → callback → redirect to `/dashboard`
- [ ] Auth guard: unauthenticated users redirected to `/`
- [ ] Admin guard: non-admin users redirected away from `/admin/*`
- [ ] Daily briefing shows overdue contacts, pending drafts, upcoming meetings
- [ ] Pipeline table sorts active opportunities first, then by urgency
- [ ] "Draft Email" opens side drawer with AI variant placeholders
- [ ] Rich text editor loads in drawer and pop-out window
- [ ] Admin dashboard renders charts and filters
- [ ] CSV upload posts to Edge Function and shows summary
- [ ] Supabase realtime updates dashboard when `activity_log` changes
- [ ] Vercel preview deployment accessible and functional
- [ ] Lighthouse accessibility score ≥ 90
- [ ] No TypeScript `any` types anywhere
- [ ] Sentry: `global-error.tsx` exists and calls `Sentry.captureException`
- [ ] Sentry: every `error.tsx` reports to Sentry via `useEffect`
- [ ] Sentry: `Sentry.setUser()` called on login, cleared on sign-out
- [ ] Sentry: data fetch hooks use `Sentry.startSpan` for performance tracing
- [ ] Sentry: AI drafting and CSV upload operations are traced
- [ ] Sentry: `Sentry.logger.*` used for key auth, draft, and import events
- [ ] Sentry: source maps uploading (verify in Sentry dashboard after deploy)
