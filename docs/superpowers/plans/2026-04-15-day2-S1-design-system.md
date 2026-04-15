# Stage 1: Design System & App Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Keychain's "Warm Precision" design system, route structure, fonts, app shell (nav bar + sidebar), and auth guard — so all subsequent stages build on a coherent visual and structural foundation.

**Architecture:** Next.js 16 App Router with route groups: `(app)` for authenticated rep views, `(admin)` for founder views. `proxy.ts` (Next.js 16's replacement for middleware.ts) handles auth redirects. Server components by default; `'use client'` only on interactive leaves.

**Tech Stack:** Next.js 16.2, React 19, Tailwind CSS v4, shadcn/ui (base-nova), Sentry (@sentry/nextjs v10 — already configured), DM Sans + JetBrains Mono (Google Fonts), Lucide React, Vitest

**Sentry note:** `@sentry/nextjs` is already installed and configured (instrumentation files, next.config.ts wrapper, client/server/edge init). This stage wires Sentry into the error boundaries and adds `global-error.tsx`.

---

## Task 1: Set Up Vitest for Unit Testing

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`

- [ ] **Step 1: Install Vitest and testing dependencies**

Run:
```bash
cd frontend && npm install -D vitest @testing-library/react @testing-library/jest-dom @vitejs/plugin-react jsdom
```

Expected: packages install successfully

- [ ] **Step 2: Create Vitest config**

Create `frontend/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

- [ ] **Step 3: Add test script to package.json**

Add to `scripts` in `frontend/package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify Vitest runs**

Run:
```bash
cd frontend && npm test
```

Expected: "No test files found" (no tests yet — that's correct)

- [ ] **Step 5: Commit**

```bash
git add frontend/vitest.config.ts frontend/package.json frontend/package-lock.json
git commit -m "chore: add Vitest with React Testing Library for unit tests"
```

---

## Task 2: Keychain Design Tokens & Theme

**Files:**
- Modify: `frontend/src/app/globals.css`

This replaces the default shadcn neutral theme with Keychain's "Warm Precision" palette. All shadcn components will automatically inherit these tokens.

- [ ] **Step 1: Replace globals.css with Keychain theme**

Overwrite `frontend/src/app/globals.css` with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

/*
 * Keychain "Warm Precision" Design Tokens
 *
 * Brand: warm gold (#F5C518) on calm neutrals
 * Approach: Bloomberg density meets airy clarity
 * Rule: gold is earned — use only for primary actions and active states
 */

@theme inline {
  /* Shadcn token mappings */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  /* Font stacks */
  --font-sans: var(--font-dm-sans);
  --font-mono: var(--font-jetbrains-mono);
  --font-heading: var(--font-dm-sans);

  /* Keychain brand colors (available as Tailwind utilities) */
  --color-kc-gold: #F5C518;
  --color-kc-gold-light: #FFF3C4;
  --color-kc-gold-dark: #D4A012;
  --color-kc-gold-subtle: #FFFDF0;
  --color-kc-charcoal: #1C1C1E;
  --color-kc-warm-white: #FAFAF8;
  --color-kc-warm-gray: #F0EEEB;
  --color-kc-warm-gray-dark: #E0DDD8;
  --color-kc-text: #2C2C2E;
  --color-kc-text-muted: #8E8E93;
  --color-kc-success: #34C759;
  --color-kc-warning: #FF9500;
  --color-kc-danger: #FF3B30;

  /* Radius */
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  /* Keychain light theme — warm whites + gold accents */
  --background: #FAFAF8;
  --foreground: #2C2C2E;
  --card: #FFFFFF;
  --card-foreground: #2C2C2E;
  --popover: #FFFFFF;
  --popover-foreground: #2C2C2E;
  --primary: #F5C518;
  --primary-foreground: #1C1C1E;
  --secondary: #F0EEEB;
  --secondary-foreground: #2C2C2E;
  --muted: #F0EEEB;
  --muted-foreground: #8E8E93;
  --accent: #FFF3C4;
  --accent-foreground: #2C2C2E;
  --destructive: #FF3B30;
  --border: #E0DDD8;
  --input: #E0DDD8;
  --ring: #F5C518;
  --radius: 0.625rem;

  /* Chart colors — gold gradient for Keychain brand cohesion */
  --chart-1: #F5C518;
  --chart-2: #D4A012;
  --chart-3: #34C759;
  --chart-4: #FF9500;
  --chart-5: #8E8E93;

  /* Sidebar — dark charcoal (Bloomberg nod) */
  --sidebar: #1C1C1E;
  --sidebar-foreground: #FAFAF8;
  --sidebar-primary: #F5C518;
  --sidebar-primary-foreground: #1C1C1E;
  --sidebar-accent: #2C2C2E;
  --sidebar-accent-foreground: #FAFAF8;
  --sidebar-border: #3A3A3C;
  --sidebar-ring: #F5C518;
}

.dark {
  /* Dark theme — for future use. Keep charcoal base + gold accents */
  --background: #1C1C1E;
  --foreground: #FAFAF8;
  --card: #2C2C2E;
  --card-foreground: #FAFAF8;
  --popover: #2C2C2E;
  --popover-foreground: #FAFAF8;
  --primary: #F5C518;
  --primary-foreground: #1C1C1E;
  --secondary: #3A3A3C;
  --secondary-foreground: #FAFAF8;
  --muted: #3A3A3C;
  --muted-foreground: #8E8E93;
  --accent: #3A3A3C;
  --accent-foreground: #FAFAF8;
  --destructive: #FF453A;
  --border: rgba(255, 255, 255, 0.1);
  --input: rgba(255, 255, 255, 0.15);
  --ring: #F5C518;
  --chart-1: #F5C518;
  --chart-2: #D4A012;
  --chart-3: #30D158;
  --chart-4: #FF9F0A;
  --chart-5: #8E8E93;
  --sidebar: #000000;
  --sidebar-foreground: #FAFAF8;
  --sidebar-primary: #F5C518;
  --sidebar-primary-foreground: #1C1C1E;
  --sidebar-accent: #1C1C1E;
  --sidebar-accent-foreground: #FAFAF8;
  --sidebar-border: rgba(255, 255, 255, 0.1);
  --sidebar-ring: #F5C518;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

- [ ] **Step 2: Verify theme compiles**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: build succeeds with no CSS errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat: replace default theme with Keychain Warm Precision design tokens"
```

---

## Task 3: Custom Fonts (DM Sans + JetBrains Mono)

**Files:**
- Modify: `frontend/src/app/layout.tsx`

Replace the default Geist fonts with DM Sans (headings/body) and JetBrains Mono (data/numbers). Both are available via `next/font/google`.

- [ ] **Step 1: Update root layout with Keychain fonts**

Overwrite `frontend/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next"
import { DM_Sans, JetBrains_Mono } from "next/font/google"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Keychain Outreach",
  description: "Daily outreach priorities and AI-drafted emails for the Keychain sales team",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Verify fonts load**

Run:
```bash
cd frontend && npm run dev &
sleep 3 && curl -s http://localhost:3000 | grep -o 'font-dm-sans\|font-jetbrains-mono' | head -5
kill %1
```

Expected: both CSS variable names appear in the rendered HTML

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/layout.tsx
git commit -m "feat: replace Geist with DM Sans + JetBrains Mono for Keychain brand typography"
```

---

## Task 4: Shared TypeScript Types

**Files:**
- Create: `frontend/src/lib/types.ts`

Define the database types that all components will use. These match the Supabase schema from `docs/database.md`.

- [ ] **Step 1: Create types file**

Create `frontend/src/lib/types.ts`:

```ts
/* ==========================================================================
 * Database types — mirrors Supabase schema from docs/database.md
 * Generate fresh types via: mcp__supabase__generate_typescript_types
 * These hand-written types are used until the generated types are available.
 * ========================================================================== */

export type ActivityType =
  | "email_sent"
  | "email_received"
  | "reply_received"
  | "meeting_held"
  | "meeting_scheduled"
  | "collateral_shared"
  | "gong_call"
  | "manual_log"
  | "post_meeting_followup"

export type ActivitySource =
  | "gmail_scan"
  | "calendar_scan"
  | "gong_detection"
  | "sf_report"
  | "slack_log"
  | "manual"

export type MeetingType =
  | "intro"
  | "meeting"
  | "proposal"
  | "next_steps"
  | "catch_up"
  | "unknown"

export interface Opportunity {
  id: string
  sf_opportunity_id: string
  sf_account_id: string | null
  account_name: string
  manufacturer_id: string | null
  opportunity_name: string
  opp_owner: string
  rep_email: string | null
  stage_name: string
  close_date: string | null
  amount: number | null
  next_step: string | null
  next_steps_c: string | null
  description: string | null
  categories: string | null
  company_category: string | null
  last_sf_sync_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  sf_contact_id: string
  first_name: string
  last_name: string
  email: string | null
  title: string | null
  created_at: string
}

export interface OpportunityContact {
  opportunity_id: string
  contact_id: string
  primary: boolean
}

export interface ActivityLog {
  id: string
  opportunity_id: string
  contact_id: string | null
  rep_email: string
  activity_type: ActivityType
  activity_date: string
  subject: string | null
  notes: string | null
  draft_copy: string | null
  source: ActivitySource
  created_at: string
}

export interface CadenceRule {
  id: string
  stage_name: string
  days_between_touches: number
  max_attempts: number
  auto_followup_on_meeting: boolean
  suggested_action: string | null
  outreach_template_key: string | null
}

export interface UpcomingMeeting {
  id: string
  opportunity_id: string
  contact_id: string | null
  rep_email: string
  meeting_title: string
  meeting_date: string
  attendees: string[]
  inferred_type: MeetingType
  stage_progression_detected: boolean
  touchpoint_drafted: boolean
  followup_drafted: boolean
  created_at: string
}

export interface RepMapping {
  id: string
  sf_display_name: string
  rep_email: string
  rep_name: string
  is_active: boolean
}

/* ==========================================================================
 * Derived / view types — used by frontend components
 * ========================================================================== */

/** A contact row enriched with opportunity and cadence data for the pipeline table */
export interface PipelineContact {
  contact: Contact
  opportunity: Opportunity
  isPrimary: boolean
  daysSinceLastTouch: number | null
  cadenceThreshold: number
  lastActivity: ActivityLog | null
  suggestedAction: string | null
  isOverdue: boolean
  isAtThreshold: boolean
}

/** Summary stats shown in the briefing header */
export interface BriefingStats {
  overdueCount: number
  pendingDraftsCount: number
  meetingsThisWeek: number
  activitiesToday: number
}

/** Urgency level for color-coding */
export type UrgencyLevel = "healthy" | "at-threshold" | "overdue"
```

- [ ] **Step 2: Verify types compile**

Run:
```bash
cd frontend && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors (or only pre-existing ones from the boilerplate page.tsx)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add shared TypeScript types matching Supabase schema"
```

---

## Task 5: Constants & Formatting Utilities

**Files:**
- Create: `frontend/src/lib/constants.ts`
- Create: `frontend/src/lib/format.ts`
- Create: `frontend/src/lib/format.test.ts`

- [ ] **Step 1: Create constants file**

Create `frontend/src/lib/constants.ts`:

```ts
/** Emails that can access /admin routes */
export const ADMIN_EMAILS = [
  "alex.gold@keychain.com",
  "dusty.reese@keychain.com",
] as const

/** Ordered list of SF pipeline stages (display order) */
export const PIPELINE_STAGES = [
  "Scheduling First Call",
  "Revival",
  "First Call Scheduled",
  "First Meeting Completed",
  "Second Call Scheduled",
  "Second Meeting Completed",
  "Proposal Meeting Scheduled",
  "Proposal Sent",
  "Next Steps Scheduled",
  "Next Steps Completed",
  "Service Agreement Sent",
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/**
 * Stages considered "active" — these opportunities sort first in the pipeline view.
 * Active = past first meeting OR has a scheduled next step.
 */
export const ACTIVE_STAGES: ReadonlySet<string> = new Set([
  "First Meeting Completed",
  "Second Call Scheduled",
  "Second Meeting Completed",
  "Proposal Meeting Scheduled",
  "Proposal Sent",
  "Next Steps Scheduled",
  "Next Steps Completed",
  "Service Agreement Sent",
])
```

- [ ] **Step 2: Write the failing test for format utilities**

Create `frontend/src/lib/format.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { formatDaysAgo, formatRelativeDate, getUrgencyLevel } from "./format"
import type { UrgencyLevel } from "./types"

describe("formatDaysAgo", () => {
  it("returns 'Today' for 0 days", () => {
    expect(formatDaysAgo(0)).toBe("Today")
  })

  it("returns 'Yesterday' for 1 day", () => {
    expect(formatDaysAgo(1)).toBe("Yesterday")
  })

  it("returns 'N days ago' for 2+ days", () => {
    expect(formatDaysAgo(5)).toBe("5 days ago")
  })

  it("returns 'Never' for null", () => {
    expect(formatDaysAgo(null)).toBe("Never")
  })
})

describe("getUrgencyLevel", () => {
  it("returns 'healthy' when days < threshold", () => {
    expect(getUrgencyLevel(1, 3)).toBe("healthy")
  })

  it("returns 'at-threshold' when days === threshold", () => {
    expect(getUrgencyLevel(3, 3)).toBe("at-threshold")
  })

  it("returns 'overdue' when days > threshold", () => {
    expect(getUrgencyLevel(5, 3)).toBe("overdue")
  })

  it("returns 'overdue' for null days (never contacted)", () => {
    expect(getUrgencyLevel(null, 3)).toBe("overdue")
  })
})

describe("formatRelativeDate", () => {
  it("formats an ISO date as a short relative string", () => {
    const today = new Date()
    const iso = today.toISOString()
    expect(formatRelativeDate(iso)).toBe("Today")
  })

  it("returns empty string for null", () => {
    expect(formatRelativeDate(null)).toBe("")
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd frontend && npm test 2>&1 | tail -10
```

Expected: FAIL — `format` module does not exist yet

- [ ] **Step 4: Write format utilities**

Create `frontend/src/lib/format.ts`:

```ts
import type { UrgencyLevel } from "./types"

/** Human-readable "N days ago" string */
export function formatDaysAgo(days: number | null): string {
  if (days === null) return "Never"
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return `${days} days ago`
}

/** Determine urgency color level based on days since touch vs cadence threshold */
export function getUrgencyLevel(
  daysSinceTouch: number | null,
  threshold: number
): UrgencyLevel {
  if (daysSinceTouch === null) return "overdue"
  if (daysSinceTouch > threshold) return "overdue"
  if (daysSinceTouch === threshold) return "at-threshold"
  return "healthy"
}

/** Format an ISO date string as a short relative date */
export function formatRelativeDate(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return formatDaysAgo(diffDays)
}

/** Format a number with commas: 1234567 → "1,234,567" */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US")
}

/** Format a currency amount: 50000 → "$50,000" */
export function formatCurrency(n: number | null): string {
  if (n === null) return "—"
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd frontend && npm test 2>&1 | tail -15
```

Expected: all 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/constants.ts frontend/src/lib/format.ts frontend/src/lib/format.test.ts
git commit -m "feat: add constants, format utilities, and unit tests"
```

---

## Task 6: Route Group Structure, Placeholder Pages & Sentry Error Boundaries

**Files:**
- Create: `frontend/src/app/global-error.tsx` — root Sentry error boundary
- Create: `frontend/src/app/(app)/layout.tsx`
- Create: `frontend/src/app/(app)/dashboard/page.tsx`
- Create: `frontend/src/app/(app)/dashboard/loading.tsx`
- Create: `frontend/src/app/(app)/dashboard/error.tsx` — Sentry-wired
- Create: `frontend/src/app/(app)/pipeline/page.tsx`
- Create: `frontend/src/app/(app)/pipeline/loading.tsx`
- Create: `frontend/src/app/(app)/pipeline/error.tsx` — Sentry-wired
- Create: `frontend/src/app/(admin)/layout.tsx`
- Create: `frontend/src/app/(admin)/admin/page.tsx`
- Create: `frontend/src/app/(admin)/admin/loading.tsx`
- Create: `frontend/src/app/(admin)/admin/error.tsx` — Sentry-wired
- Create: `frontend/src/app/(admin)/admin/upload/page.tsx`
- Modify: `frontend/src/app/page.tsx` — replace boilerplate with login placeholder

- [ ] **Step 1: Create global-error.tsx (root Sentry error boundary)**

This is the top-level error boundary for the entire app. It catches errors that escape all route-level `error.tsx` files. It must define its own `<html>` and `<body>` tags (Next.js 16 requirement). It reports to Sentry on mount.

Create `frontend/src/app/global-error.tsx`:

```tsx
"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#FAFAF8", color: "#2C2C2E" }}>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", maxWidth: "400px" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: "0.5rem", color: "#8E8E93" }}>
              An unexpected error occurred. Our team has been notified.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: "1rem",
                padding: "0.5rem 1rem",
                background: "#F5C518",
                color: "#1C1C1E",
                border: "none",
                borderRadius: "0.5rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Create login placeholder (root page)** 

Overwrite `frontend/src/app/page.tsx`:

```tsx
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-kc-warm-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-kc-charcoal">
          keychain
        </h1>
        <p className="mt-2 text-kc-text-muted">
          Outreach Tool — login page placeholder
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create authenticated app layout**

Create `frontend/src/app/(app)/layout.tsx`:

```tsx
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar will be added in a later step */}
      <div className="flex-1 flex flex-col">
        {/* Nav bar will be added in a later step */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create dashboard page + loading + error**

Create `frontend/src/app/(app)/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-kc-charcoal">Good morning</h1>
      <p className="mt-1 text-kc-text-muted">
        Your daily briefing — placeholder
      </p>
    </div>
  )
}
```

Create `frontend/src/app/(app)/dashboard/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
```

Create `frontend/src/app/(app)/dashboard/error.tsx`:

```tsx
"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <h2 className="text-xl font-semibold text-kc-charcoal">
        Something went wrong
      </h2>
      <p className="mt-2 text-kc-text-muted">
        {error.message || "Failed to load your dashboard."}
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-kc-gold px-4 py-2 text-sm font-medium text-kc-charcoal transition-colors hover:bg-kc-gold-dark"
      >
        Try again
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create pipeline page + loading + error**

Create `frontend/src/app/(app)/pipeline/page.tsx`:

```tsx
export default function PipelinePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-kc-charcoal">Pipeline</h1>
      <p className="mt-1 text-kc-text-muted">
        All opportunities — placeholder
      </p>
    </div>
  )
}
```

Create `frontend/src/app/(app)/pipeline/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function PipelineLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-48" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  )
}
```

Create `frontend/src/app/(app)/pipeline/error.tsx`:

```tsx
"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function PipelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <h2 className="text-xl font-semibold text-kc-charcoal">
        Something went wrong
      </h2>
      <p className="mt-2 text-kc-text-muted">
        {error.message || "Failed to load your pipeline."}
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-kc-gold px-4 py-2 text-sm font-medium text-kc-charcoal transition-colors hover:bg-kc-gold-dark"
      >
        Try again
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Create admin layout + pages**

Create `frontend/src/app/(admin)/layout.tsx`:

```tsx
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <div className="flex-1 flex flex-col">
        {/* Admin nav will be added later */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
```

Create `frontend/src/app/(admin)/admin/page.tsx`:

```tsx
export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-kc-charcoal">Team Dashboard</h1>
      <p className="mt-1 text-kc-text-muted">
        Founder view — placeholder
      </p>
    </div>
  )
}
```

Create `frontend/src/app/(admin)/admin/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  )
}
```

Create `frontend/src/app/(admin)/admin/error.tsx`:

```tsx
"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <h2 className="text-xl font-semibold text-kc-charcoal">
        Something went wrong
      </h2>
      <p className="mt-2 text-kc-text-muted">
        {error.message || "Failed to load admin dashboard."}
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-kc-gold px-4 py-2 text-sm font-medium text-kc-charcoal transition-colors hover:bg-kc-gold-dark"
      >
        Try again
      </button>
    </div>
  )
}
```

Create `frontend/src/app/(admin)/admin/upload/page.tsx`:

```tsx
export default function CsvUploadPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-kc-charcoal">CSV Upload</h1>
      <p className="mt-1 text-kc-text-muted">
        Import contacts from Salesforce — placeholder
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Delete boilerplate assets**

Run:
```bash
rm frontend/public/next.svg frontend/public/vercel.svg frontend/public/file-text.svg frontend/public/globe.svg frontend/public/window.svg 2>/dev/null; echo "cleaned"
```

- [ ] **Step 7: Verify all routes build**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds, routes listed include `/`, `/dashboard`, `/pipeline`, `/admin`, `/admin/upload`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/ -A
git commit -m "feat: add route groups, Sentry error boundaries, global-error.tsx, and placeholder pages"
```

---

## Task 7: Keychain Sparkle Icon & Logo Component

**Files:**
- Create: `frontend/src/components/layout/sparkle-icon.tsx`
- Create: `frontend/src/components/layout/keychain-logo.tsx`

The four-pointed sparkle from the Keychain Zoom background, used as a brand motif throughout the app (loading states, empty states, brand accent).

- [ ] **Step 1: Create sparkle icon**

Create `frontend/src/components/layout/sparkle-icon.tsx`:

```tsx
import { cn } from "@/lib/utils"

interface SparkleIconProps {
  className?: string
  size?: number
}

export function SparkleIcon({ className, size = 16 }: SparkleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-kc-gold", className)}
    >
      <path
        d="M8 0C8 0 9.5 5.5 8 8C6.5 10.5 0 8 0 8C0 8 6.5 9.5 8 8C9.5 6.5 8 0 8 0Z"
        fill="currentColor"
      />
      <path
        d="M8 16C8 16 6.5 10.5 8 8C9.5 5.5 16 8 16 8C16 8 9.5 6.5 8 8C6.5 9.5 8 16 8 16Z"
        fill="currentColor"
      />
    </svg>
  )
}
```

- [ ] **Step 2: Create logo component**

Create `frontend/src/components/layout/keychain-logo.tsx`:

```tsx
import { cn } from "@/lib/utils"
import { SparkleIcon } from "./sparkle-icon"

interface KeychainLogoProps {
  className?: string
  size?: "sm" | "md" | "lg"
  showSparkle?: boolean
}

const sizeMap = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
} as const

export function KeychainLogo({
  className,
  size = "md",
  showSparkle = true,
}: KeychainLogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "font-bold tracking-tight text-kc-charcoal",
          sizeMap[size]
        )}
      >
        keychain
      </span>
      {showSparkle && (
        <SparkleIcon
          size={size === "sm" ? 10 : size === "md" ? 14 : 18}
          className="text-kc-gold"
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/sparkle-icon.tsx frontend/src/components/layout/keychain-logo.tsx
git commit -m "feat: add Keychain sparkle icon and logo components"
```

---

## Task 8: Navigation Bar Component

**Files:**
- Create: `frontend/src/components/layout/app-nav.tsx`
- Create: `frontend/src/components/layout/user-menu.tsx`
- Modify: `frontend/src/app/(app)/layout.tsx` — wire up nav

The top navigation bar: dark charcoal background, Keychain logo on the left, navigation links in the center, user avatar + dropdown on the right.

- [ ] **Step 1: Create user menu dropdown**

Create `frontend/src/components/layout/user-menu.tsx`:

```tsx
"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, Settings } from "lucide-react"

interface UserMenuProps {
  name: string
  email: string
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function UserMenu({ name, email }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10">
          <Avatar className="h-7 w-7 border border-white/20">
            <AvatarFallback className="bg-kc-gold text-xs font-semibold text-kc-charcoal">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-white/90 md:block">
            {name}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Create app navigation bar**

Create `frontend/src/components/layout/app-nav.tsx`:

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { KeychainLogo } from "./keychain-logo"
import { UserMenu } from "./user-menu"
import { LayoutDashboard, GitBranch } from "lucide-react"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Briefing", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
] as const

export function AppNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/10 bg-kc-charcoal px-4">
      {/* Left: logo */}
      <Link href="/dashboard" className="flex items-center">
        <KeychainLogo size="sm" className="[&_span]:text-white" />
      </Link>

      {/* Center: nav links */}
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-kc-gold/15 text-kc-gold"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Right: user menu */}
      <UserMenu name="Alex Gold" email="alex.gold@keychain.com" />
    </header>
  )
}
```

- [ ] **Step 3: Wire nav into app layout**

Update `frontend/src/app/(app)/layout.tsx`:

```tsx
import { AppNav } from "@/components/layout/app-nav"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppNav />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 4: Verify nav renders**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/app-nav.tsx frontend/src/components/layout/user-menu.tsx frontend/src/app/\(app\)/layout.tsx
git commit -m "feat: add app navigation bar with Keychain branding and user menu"
```

---

## Task 9: Supabase Client Setup

**Files:**
- Create: `frontend/src/lib/supabase/client.ts`
- Create: `frontend/src/lib/supabase/server.ts`

Set up Supabase clients for browser and server components. Uses `@supabase/ssr` for cookie-based auth in Next.js.

- [ ] **Step 1: Create browser client**

Create `frontend/src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Create server client**

Create `frontend/src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll is called from a Server Component where cookies
            // can't be set. This is safe to ignore — the proxy.ts
            // will refresh the session on the next request.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Create .env.local template**

Create `frontend/.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://hjxaqhbkdvckapsqvqcq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

- [ ] **Step 4: Verify build still passes**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds (env vars aren't needed at build time for client-side usage)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/supabase/ frontend/.env.local.example
git commit -m "feat: add Supabase browser and server clients with cookie-based auth"
```

---

## Task 10: Auth Guard Proxy (Next.js 16)

**Files:**
- Create: `frontend/src/proxy.ts`

Next.js 16 renamed `middleware.ts` to `proxy.ts`. This checks for a Supabase session and redirects unauthenticated users to `/`. Also blocks non-admins from `/admin/*` routes.

- [ ] **Step 1: Create proxy.ts**

Create `frontend/src/proxy.ts`:

```ts
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { ADMIN_EMAILS } from "@/lib/constants"

const PUBLIC_ROUTES = new Set(["/"])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes through
  if (PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.next()
  }

  // Create a Supabase client that can read/write cookies on the response
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session (important — keeps the session alive)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  // Block non-admins from admin routes
  if (pathname.startsWith("/admin")) {
    const isAdmin = ADMIN_EMAILS.includes(
      user.email as (typeof ADMIN_EMAILS)[number]
    )
    if (!isAdmin) {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - API routes (handled separately)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/).*)",
  ],
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/proxy.ts
git commit -m "feat: add auth guard proxy with admin route protection (Next.js 16 proxy.ts)"
```

---

## Task 11: Stage 1 Review Checkpoint

Run all skill-based reviews to validate the foundation before moving to Stage 2.

- [ ] **Step 1: Build verification**

Run:
```bash
cd frontend && npm run build && npm test
```

Expected: build succeeds, all tests pass

- [ ] **Step 2: Start dev server and visually verify**

Run:
```bash
cd frontend && npm run dev
```

Open in browser and verify:
- `http://localhost:3000` — shows login placeholder with "keychain" text
- `http://localhost:3000/dashboard` — shows "Good morning" placeholder (or redirects to `/` if proxy is active)
- `http://localhost:3000/pipeline` — shows "Pipeline" placeholder
- `http://localhost:3000/admin` — shows "Team Dashboard" placeholder
- `http://localhost:3000/admin/upload` — shows "CSV Upload" placeholder

- [ ] **Step 3: Verify Sentry integration is intact**

Run:
```bash
cd frontend && npm run build 2>&1 | grep -i sentry
```

Expected: Sentry webpack plugin output showing source map upload (or "silent" mode if no CI env). Confirm `withSentryConfig` is still wrapping `next.config.ts` and instrumentation files are unchanged.

- [ ] **Step 4: Run skill reviews**

Execute each of these review skills:

1. **`vercel:next-best-practices`** — verify file conventions, RSC boundaries, data patterns
2. **`vercel:react-best-practices`** — run TSX quality checklist on all new components
3. **`vercel:shadcn`** — verify shadcn/ui integration and theme setup
4. **`code-reviewer`** — code review pass for correctness, security, naming
5. **`verification-before-completion`** — full build + type check + browser verification

- [ ] **Step 5: Deploy preview to Vercel**

Run: **`vercel:deploy`** — deploy preview build and verify it renders. After deploy, check Sentry dashboard for source maps under Releases.

- [ ] **Step 6: Fix any issues surfaced by reviews**

Address findings from the skill reviews before proceeding to Stage 2.

- [ ] **Step 7: Final commit for Stage 1**

```bash
git add -A
git commit -m "chore: Stage 1 complete — design system, app shell, routes, auth guard"
```

---

## Stage 1 Completion Checklist

- [ ] `npm run build` succeeds with zero errors
- [ ] `npm test` — all unit tests pass
- [ ] Keychain gold (#F5C518) renders as primary button color
- [ ] DM Sans renders as heading/body font
- [ ] JetBrains Mono renders when `font-mono` class is used
- [ ] Dark charcoal nav bar renders at top of `/dashboard` and `/pipeline`
- [ ] Sparkle icon and logo component render correctly
- [ ] Route groups work: `/`, `/dashboard`, `/pipeline`, `/admin`, `/admin/upload`
- [ ] Loading skeletons appear for each route
- [ ] Error boundaries display with "Try again" button and call `Sentry.captureException`
- [ ] `global-error.tsx` exists at app root with Sentry reporting
- [ ] User menu dropdown opens with avatar, name, email, settings, sign out
- [ ] Proxy.ts compiles and is included in the build
- [ ] Supabase client files exist and compile
- [ ] Sentry: `withSentryConfig` still wraps `next.config.ts` (not overwritten)
- [ ] Sentry: instrumentation files unchanged and functional
- [ ] Sentry: build produces source maps (check `.next/` output or Sentry dashboard)
- [ ] No TypeScript `any` types
- [ ] `vercel:deploy` preview accessible
