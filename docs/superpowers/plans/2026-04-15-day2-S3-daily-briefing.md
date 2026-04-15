# Stage 3: Daily Briefing Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/dashboard` daily briefing — the page reps open every morning. Shows a greeting with summary stats, overdue contacts needing follow-up, pending unsent drafts, and upcoming meetings this week. Designed for <5 min daily interaction.

**Architecture:** Server component page fetches data from Supabase, passes to client components for interactivity. Data queries use `Sentry.startSpan` for performance tracing. Empty states handled gracefully (activity_log and upcoming_meetings are currently empty — backend scans haven't run yet). The briefing is card-based, not table-based — optimized for scanning, not searching.

**Tech Stack:** Next.js 16 server components, Supabase JS (server client), Sentry tracing, shadcn/ui cards/badges, Lucide icons

**Current DB state:** 4,290 opportunities, 7,997 contacts, 11 cadence rules, 48 active reps. 0 activities, 0 meetings (populated by backend scans later).

---

## Task 1: Server-Side Data Fetching Functions

**Files:**
- Create: `frontend/src/lib/data/dashboard.ts`

Server-side functions that query Supabase for the dashboard. Each wrapped in `Sentry.startSpan` for tracing.

- [ ] **Step 1: Create dashboard data functions**

Create `frontend/src/lib/data/dashboard.ts`:

```ts
import "server-only"

import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/server"
import type {
  PipelineContact,
  BriefingStats,
  ActivityLog,
  UpcomingMeeting,
} from "@/lib/types"

/** Fetch contacts that are overdue for follow-up for the current user */
export async function getOverdueContacts(repEmail: string): Promise<PipelineContact[]> {
  return Sentry.startSpan({ name: "dashboard.getOverdueContacts", op: "db.query" }, async () => {
    const supabase = await createClient()

    // Get opportunities for this rep with their contacts and cadence rules
    const { data: opportunities, error } = await supabase
      .from("opportunities")
      .select(`
        *,
        opportunity_contacts(
          primary,
          contacts(*)
        ),
        cadence_rules:cadence_rules!inner(
          days_between_touches,
          suggested_action
        )
      `)
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null)

    if (error) {
      Sentry.captureException(error)
      return []
    }

    if (!opportunities) return []

    // For each opportunity, find the last activity and calculate days since touch
    const now = new Date()
    const results: PipelineContact[] = []

    for (const opp of opportunities) {
      const cadence = Array.isArray(opp.cadence_rules) ? opp.cadence_rules[0] : opp.cadence_rules
      if (!cadence) continue

      // Get last activity for this opportunity
      const { data: lastActivity } = await supabase
        .from("activity_log")
        .select("*")
        .eq("opportunity_id", opp.id)
        .order("activity_date", { ascending: false })
        .limit(1)
        .single()

      const daysSinceLastTouch = lastActivity
        ? Math.floor((now.getTime() - new Date(lastActivity.activity_date).getTime()) / (1000 * 60 * 60 * 24))
        : null

      const threshold = cadence.days_between_touches
      const isOverdue = daysSinceLastTouch === null || daysSinceLastTouch > threshold
      const isAtThreshold = daysSinceLastTouch === threshold

      if (!isOverdue && !isAtThreshold) continue

      const oppContacts = opp.opportunity_contacts ?? []
      const primaryContact = oppContacts.find((oc: { primary: boolean }) => oc.primary)
      const contact = primaryContact?.contacts ?? oppContacts[0]?.contacts

      if (!contact) continue

      results.push({
        contact,
        opportunity: opp,
        isPrimary: primaryContact?.primary ?? false,
        daysSinceLastTouch,
        cadenceThreshold: threshold,
        lastActivity: lastActivity ?? null,
        suggestedAction: cadence.suggested_action,
        isOverdue,
        isAtThreshold,
      })
    }

    // Sort: most overdue first (null = never contacted = most urgent)
    results.sort((a, b) => {
      if (a.daysSinceLastTouch === null) return -1
      if (b.daysSinceLastTouch === null) return 1
      return b.daysSinceLastTouch - a.daysSinceLastTouch
    })

    return results
  })
}

/** Fetch pending drafts (activity_log entries with draft_copy that haven't been sent) */
export async function getPendingDrafts(repEmail: string): Promise<ActivityLog[]> {
  return Sentry.startSpan({ name: "dashboard.getPendingDrafts", op: "db.query" }, async () => {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("rep_email", repEmail)
      .not("draft_copy", "is", null)
      .not("activity_type", "eq", "email_sent")
      .order("created_at", { ascending: false })
      .limit(10)

    if (error) {
      Sentry.captureException(error)
      return []
    }

    return data ?? []
  })
}

/** Fetch upcoming meetings for this week */
export async function getUpcomingMeetings(repEmail: string): Promise<UpcomingMeeting[]> {
  return Sentry.startSpan({ name: "dashboard.getUpcomingMeetings", op: "db.query" }, async () => {
    const supabase = await createClient()

    const now = new Date()
    const endOfWeek = new Date(now)
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()))

    const { data, error } = await supabase
      .from("upcoming_meetings")
      .select("*")
      .eq("rep_email", repEmail)
      .gte("meeting_date", now.toISOString())
      .lte("meeting_date", endOfWeek.toISOString())
      .order("meeting_date", { ascending: true })

    if (error) {
      Sentry.captureException(error)
      return []
    }

    return data ?? []
  })
}

/** Get summary stats for the briefing header */
export async function getBriefingStats(
  overdueContacts: PipelineContact[],
  pendingDrafts: ActivityLog[],
  upcomingMeetings: UpcomingMeeting[],
  repEmail: string
): Promise<BriefingStats> {
  return Sentry.startSpan({ name: "dashboard.getBriefingStats", op: "db.query" }, async () => {
    const supabase = await createClient()

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { count } = await supabase
      .from("activity_log")
      .select("*", { count: "exact", head: true })
      .eq("rep_email", repEmail)
      .gte("activity_date", today.toISOString())

    return {
      overdueCount: overdueContacts.length,
      pendingDraftsCount: pendingDrafts.length,
      meetingsThisWeek: upcomingMeetings.length,
      activitiesToday: count ?? 0,
    }
  })
}
```

- [ ] **Step 2: Install server-only package**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm install server-only
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/lib/data/dashboard.ts frontend/package.json frontend/package-lock.json && git commit -m "feat: add server-side dashboard data fetching with Sentry tracing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Briefing Header Component

**Files:**
- Create: `frontend/src/components/dashboard/briefing-header.tsx`

Shows greeting (time-based) + 4 summary stat cards in a row.

- [ ] **Step 1: Create briefing header**

Create `frontend/src/components/dashboard/briefing-header.tsx`:

```tsx
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle, Mail, Calendar, Activity } from "lucide-react"
import type { BriefingStats } from "@/lib/types"

interface BriefingHeaderProps {
  repName: string
  stats: BriefingStats
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

const STAT_CARDS = [
  {
    key: "overdue" as const,
    label: "Overdue",
    icon: AlertTriangle,
    getValue: (s: BriefingStats) => s.overdueCount,
    color: "text-kc-danger",
    bgColor: "bg-kc-danger/10",
  },
  {
    key: "drafts" as const,
    label: "Pending Drafts",
    icon: Mail,
    getValue: (s: BriefingStats) => s.pendingDraftsCount,
    color: "text-kc-warning",
    bgColor: "bg-kc-warning/10",
  },
  {
    key: "meetings" as const,
    label: "Meetings This Week",
    icon: Calendar,
    getValue: (s: BriefingStats) => s.meetingsThisWeek,
    color: "text-kc-gold-dark",
    bgColor: "bg-kc-gold/10",
  },
  {
    key: "activities" as const,
    label: "Activities Today",
    icon: Activity,
    getValue: (s: BriefingStats) => s.activitiesToday,
    color: "text-kc-success",
    bgColor: "bg-kc-success/10",
  },
] as const

export function BriefingHeader({ repName, stats }: BriefingHeaderProps) {
  const firstName = repName.split(" ")[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">
          {getGreeting()}, {firstName}
        </h1>
        <p className="mt-1 text-kc-text-muted">
          Here&apos;s your daily briefing
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, getValue, color, bgColor }) => (
          <Card key={key} className="border-kc-warm-gray-dark/50">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bgColor}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <div>
                <p className="font-mono text-2xl font-bold text-kc-charcoal">
                  {getValue(stats)}
                </p>
                <p className="text-xs text-kc-text-muted">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/dashboard/briefing-header.tsx && git commit -m "feat: add briefing header with greeting and summary stat cards

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Overdue Contacts, Pending Drafts & Meetings Components

**Files:**
- Create: `frontend/src/components/dashboard/overdue-contacts-list.tsx`
- Create: `frontend/src/components/dashboard/pending-drafts-list.tsx`
- Create: `frontend/src/components/dashboard/upcoming-meetings-list.tsx`
- Create: `frontend/src/components/dashboard/empty-state.tsx`
- Create: `frontend/src/components/pipeline/stage-badge.tsx`
- Create: `frontend/src/components/pipeline/urgency-dot.tsx`

- [ ] **Step 1: Create shared empty state component**

Create `frontend/src/components/dashboard/empty-state.tsx`:

```tsx
import { SparkleIcon } from "@/components/layout/sparkle-icon"

interface EmptyStateProps {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <SparkleIcon size={24} className="mb-3 text-kc-warm-gray-dark" />
      <p className="text-sm font-medium text-kc-charcoal">{title}</p>
      <p className="mt-1 text-xs text-kc-text-muted">{description}</p>
    </div>
  )
}
```

- [ ] **Step 2: Create stage badge (shared with pipeline)**

Create `frontend/src/components/pipeline/stage-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ACTIVE_STAGES } from "@/lib/constants"

interface StageBadgeProps {
  stage: string
  className?: string
}

export function StageBadge({ stage, className }: StageBadgeProps) {
  const isActive = ACTIVE_STAGES.has(stage)

  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-normal",
        isActive
          ? "border-kc-gold/30 bg-kc-gold-subtle text-kc-charcoal"
          : "border-kc-warm-gray-dark bg-kc-warm-gray text-kc-text-muted",
        className
      )}
    >
      {stage}
    </Badge>
  )
}
```

- [ ] **Step 3: Create urgency dot (shared with pipeline)**

Create `frontend/src/components/pipeline/urgency-dot.tsx`:

```tsx
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatDaysAgo } from "@/lib/format"
import type { UrgencyLevel } from "@/lib/types"

interface UrgencyDotProps {
  level: UrgencyLevel
  daysSinceTouch: number | null
  threshold: number
}

const URGENCY_COLORS: Record<UrgencyLevel, string> = {
  healthy: "bg-kc-success",
  "at-threshold": "bg-kc-warning",
  overdue: "bg-kc-danger",
}

export function UrgencyDot({ level, daysSinceTouch, threshold }: UrgencyDotProps) {
  const label = `Last touch: ${formatDaysAgo(daysSinceTouch)} (threshold: ${threshold} days)`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative flex h-3 w-3" aria-label={label}>
          {level === "overdue" && (
            <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", URGENCY_COLORS[level])} />
          )}
          <span className={cn("relative inline-flex h-3 w-3 rounded-full", URGENCY_COLORS[level])} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}
```

- [ ] **Step 4: Create overdue contacts list**

Create `frontend/src/components/dashboard/overdue-contacts-list.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Mail } from "lucide-react"
import { StageBadge } from "@/components/pipeline/stage-badge"
import { UrgencyDot } from "@/components/pipeline/urgency-dot"
import { EmptyState } from "./empty-state"
import { formatDaysAgo, getUrgencyLevel } from "@/lib/format"
import type { PipelineContact } from "@/lib/types"

interface OverdueContactsListProps {
  contacts: PipelineContact[]
}

export function OverdueContactsList({ contacts }: OverdueContactsListProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-kc-danger" />
          Contacts Due for Follow-up
          {contacts.length > 0 && (
            <span className="font-mono text-sm text-kc-text-muted">
              ({contacts.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <EmptyState
            title="You're all caught up"
            description="No contacts are overdue for follow-up right now"
          />
        ) : (
          <div className="space-y-2">
            {contacts.slice(0, 10).map((item) => (
              <div
                key={`${item.opportunity.id}-${item.contact.id}`}
                className="flex items-center gap-3 rounded-lg border border-kc-warm-gray-dark/30 bg-white p-3 transition-colors hover:border-kc-gold/30 hover:bg-kc-gold-subtle/30"
              >
                <UrgencyDot
                  level={getUrgencyLevel(item.daysSinceLastTouch, item.cadenceThreshold)}
                  daysSinceTouch={item.daysSinceLastTouch}
                  threshold={item.cadenceThreshold}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-kc-charcoal truncate">
                      {item.contact.first_name} {item.contact.last_name}
                    </p>
                    <StageBadge stage={item.opportunity.stage_name} />
                  </div>
                  <p className="text-xs text-kc-text-muted truncate">
                    {item.opportunity.account_name}
                    {item.contact.title && ` · ${item.contact.title}`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs font-medium text-kc-danger">
                    {formatDaysAgo(item.daysSinceLastTouch)}
                  </p>
                  {item.suggestedAction && (
                    <p className="mt-0.5 text-xs text-kc-text-muted truncate max-w-[150px]">
                      {item.suggestedAction}
                    </p>
                  )}
                </div>

                <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-kc-gold/50 text-kc-charcoal hover:bg-kc-gold/10">
                  <Mail className="h-3.5 w-3.5" />
                  Draft
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Create pending drafts list**

Create `frontend/src/components/dashboard/pending-drafts-list.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail } from "lucide-react"
import { EmptyState } from "./empty-state"
import type { ActivityLog } from "@/lib/types"

interface PendingDraftsListProps {
  drafts: ActivityLog[]
}

export function PendingDraftsList({ drafts }: PendingDraftsListProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-kc-warning" />
          Drafts Awaiting Send
          {drafts.length > 0 && (
            <span className="font-mono text-sm text-kc-text-muted">
              ({drafts.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {drafts.length === 0 ? (
          <EmptyState
            title="No pending drafts"
            description="Drafted emails will appear here once the daily scan runs"
          />
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center gap-3 rounded-lg border border-kc-warm-gray-dark/30 bg-white p-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kc-warning/10">
                  <Mail className="h-4 w-4 text-kc-warning" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-kc-charcoal truncate">
                    {draft.subject ?? "Untitled draft"}
                  </p>
                  <p className="text-xs text-kc-text-muted">
                    Created {new Date(draft.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Create upcoming meetings list**

Create `frontend/src/components/dashboard/upcoming-meetings-list.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "./empty-state"
import type { UpcomingMeeting } from "@/lib/types"

interface UpcomingMeetingsListProps {
  meetings: UpcomingMeeting[]
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  intro: "Intro",
  meeting: "Meeting",
  proposal: "Proposal",
  next_steps: "Next Steps",
  catch_up: "Catch-up",
  unknown: "Meeting",
}

export function UpcomingMeetingsList({ meetings }: UpcomingMeetingsListProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4 text-kc-gold-dark" />
          Upcoming Meetings
          {meetings.length > 0 && (
            <span className="font-mono text-sm text-kc-text-muted">
              ({meetings.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {meetings.length === 0 ? (
          <EmptyState
            title="No meetings this week"
            description="Matched meetings will appear here after the weekly scan runs"
          />
        ) : (
          <div className="space-y-2">
            {meetings.map((meeting) => {
              const date = new Date(meeting.meeting_date)
              return (
                <div
                  key={meeting.id}
                  className="flex items-center gap-3 rounded-lg border border-kc-warm-gray-dark/30 bg-white p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-kc-gold/10">
                    <span className="text-xs font-medium uppercase text-kc-gold-dark">
                      {date.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className="font-mono text-sm font-bold text-kc-charcoal">
                      {date.getDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-kc-charcoal truncate">
                      {meeting.meeting_title}
                    </p>
                    <p className="text-xs text-kc-text-muted">
                      {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 border-kc-warm-gray-dark bg-kc-warm-gray text-kc-text-muted">
                    {MEETING_TYPE_LABELS[meeting.inferred_type] ?? "Meeting"}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/dashboard/ frontend/src/components/pipeline/stage-badge.tsx frontend/src/components/pipeline/urgency-dot.tsx && git commit -m "feat: add briefing components — overdue contacts, drafts, meetings, empty states

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire Dashboard Page

**Files:**
- Modify: `frontend/src/app/(app)/dashboard/page.tsx`

Replace the placeholder with real data fetching and components.

- [ ] **Step 1: Update dashboard page**

Overwrite `frontend/src/app/(app)/dashboard/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server"
import { BriefingHeader } from "@/components/dashboard/briefing-header"
import { OverdueContactsList } from "@/components/dashboard/overdue-contacts-list"
import { PendingDraftsList } from "@/components/dashboard/pending-drafts-list"
import { UpcomingMeetingsList } from "@/components/dashboard/upcoming-meetings-list"
import {
  getOverdueContacts,
  getPendingDrafts,
  getUpcomingMeetings,
  getBriefingStats,
} from "@/lib/data/dashboard"

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const repEmail = user?.email ?? ""
  const repName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "there"

  // Fetch all dashboard data in parallel
  const [overdueContacts, pendingDrafts, upcomingMeetings] = await Promise.all([
    getOverdueContacts(repEmail),
    getPendingDrafts(repEmail),
    getUpcomingMeetings(repEmail),
  ])

  const stats = await getBriefingStats(overdueContacts, pendingDrafts, upcomingMeetings, repEmail)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BriefingHeader repName={repName} stats={stats} />

      <div className="space-y-4">
        <OverdueContactsList contacts={overdueContacts} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PendingDraftsList drafts={pendingDrafts} />
          <UpcomingMeetingsList meetings={upcomingMeetings} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds, `/dashboard` is now `ƒ` (dynamic, server-rendered)

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add "frontend/src/app/(app)/dashboard/page.tsx" && git commit -m "feat: wire dashboard page with real data fetching and briefing components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Stage 3 Completion Checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes (existing tests still green)
- [ ] `/dashboard` renders briefing header with greeting and 4 stat cards
- [ ] Overdue contacts section shows empty state (no activity data yet) or real data
- [ ] Pending drafts section shows empty state
- [ ] Upcoming meetings section shows empty state
- [ ] Empty states use sparkle icon and descriptive text
- [ ] Stat card numbers use `font-mono` (JetBrains Mono)
- [ ] Urgency dots animate (ping) for overdue contacts
- [ ] Stage badges distinguish active vs early-stage opportunities
- [ ] "Draft" button appears on each overdue contact row
- [ ] All data queries wrapped in `Sentry.startSpan`
- [ ] No TypeScript `any` types
