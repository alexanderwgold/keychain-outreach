# Stage 4: Full Pipeline View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/pipeline` page — a full table of all opportunities with contacts for the logged-in rep. Sorted active opportunities first, then early-stage. Filterable by stage and searchable by contact/company name. Paginated (25 per page) since reps can have 80-160+ opportunities.

**Architecture:** Server component fetches the first page of data. Client-side `PipelineTable` handles filtering, sorting, and pagination via URL search params. Uses the `stage-badge` and `urgency-dot` components from Stage 3.

**Tech Stack:** Next.js 16 server components, Supabase JS, shadcn/ui table/badge/input, Lucide icons

**Data:** Reps have 80-160 opportunities on average (one outlier at 2,267). Each opportunity has 1-3 contacts. Server-side pagination at 25 rows.

---

## Task 1: Pipeline Data Fetching

**Files:**
- Create: `frontend/src/lib/data/pipeline.ts`

- [ ] **Step 1: Create pipeline data functions**

Create `frontend/src/lib/data/pipeline.ts`:

```ts
import "server-only"

import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/server"
import { ACTIVE_STAGES } from "@/lib/constants"

export interface PipelineRow {
  opportunityId: string
  accountName: string
  opportunityName: string
  stageName: string
  amount: number | null
  closeDate: string | null
  contactName: string
  contactEmail: string | null
  contactTitle: string | null
  contactId: string
  isPrimary: boolean
  isActiveStage: boolean
  daysSinceLastTouch: number | null
  cadenceThreshold: number | null
  suggestedAction: string | null
}

export interface PipelineResult {
  rows: PipelineRow[]
  totalCount: number
  page: number
  pageSize: number
}

export async function getPipelineData(
  repEmail: string,
  options: {
    page?: number
    pageSize?: number
    stageFilter?: string
    search?: string
  } = {}
): Promise<PipelineResult> {
  return Sentry.startSpan({ name: "pipeline.getPipelineData", op: "db.query" }, async () => {
    const supabase = await createClient()
    const page = options.page ?? 1
    const pageSize = options.pageSize ?? 25
    const offset = (page - 1) * pageSize

    // Build query
    let query = supabase
      .from("opportunities")
      .select(`
        id,
        account_name,
        opportunity_name,
        stage_name,
        amount,
        close_date,
        opportunity_contacts(
          primary,
          contacts(id, first_name, last_name, email, title)
        )
      `, { count: "exact" })
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null)

    if (options.stageFilter) {
      query = query.eq("stage_name", options.stageFilter)
    }

    if (options.search) {
      query = query.or(`account_name.ilike.%${options.search}%,opportunity_name.ilike.%${options.search}%`)
    }

    // Order: active stages first, then by account name
    query = query
      .order("account_name", { ascending: true })
      .range(offset, offset + pageSize - 1)

    const { data: opportunities, count, error } = await query

    if (error) {
      Sentry.captureException(error)
      return { rows: [], totalCount: 0, page, pageSize }
    }

    if (!opportunities) return { rows: [], totalCount: 0, page, pageSize }

    // Get cadence rules for threshold lookup
    const { data: cadenceRules } = await supabase.from("cadence_rules").select("*")
    const cadenceMap = new Map((cadenceRules ?? []).map(r => [r.stage_name, r]))

    // Flatten opportunities into rows (one per primary contact)
    const rows: PipelineRow[] = []

    for (const opp of opportunities) {
      const oppContacts = opp.opportunity_contacts ?? []
      const primaryOc = oppContacts.find((oc: { primary: boolean }) => oc.primary)
      const contact = primaryOc?.contacts ?? oppContacts[0]?.contacts

      if (!contact) continue

      const cadence = cadenceMap.get(opp.stage_name)
      const isActive = ACTIVE_STAGES.has(opp.stage_name)

      rows.push({
        opportunityId: opp.id,
        accountName: opp.account_name,
        opportunityName: opp.opportunity_name,
        stageName: opp.stage_name,
        amount: opp.amount,
        closeDate: opp.close_date,
        contactName: `${contact.first_name} ${contact.last_name}`,
        contactEmail: contact.email,
        contactTitle: contact.title,
        contactId: contact.id,
        isPrimary: primaryOc?.primary ?? false,
        isActiveStage: isActive,
        daysSinceLastTouch: null, // Will be populated when activity_log has data
        cadenceThreshold: cadence?.days_between_touches ?? null,
        suggestedAction: cadence?.suggested_action ?? null,
      })
    }

    // Sort: active stages first, then alphabetical
    rows.sort((a, b) => {
      if (a.isActiveStage !== b.isActiveStage) return a.isActiveStage ? -1 : 1
      return a.accountName.localeCompare(b.accountName)
    })

    return { rows, totalCount: count ?? 0, page, pageSize }
  })
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/lib/data/pipeline.ts && git commit -m "feat: add pipeline data fetching with pagination, filtering, and search

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pipeline Table & Filter Components

**Files:**
- Create: `frontend/src/components/pipeline/pipeline-table.tsx`
- Create: `frontend/src/components/pipeline/pipeline-filters.tsx`

- [ ] **Step 1: Create pipeline filters**

Create `frontend/src/components/pipeline/pipeline-filters.tsx`:

```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search } from "lucide-react"
import { PIPELINE_STAGES } from "@/lib/constants"

export function PipelineFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const currentStage = searchParams.get("stage") ?? ""
  const currentSearch = searchParams.get("q") ?? ""

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      params.delete("page") // Reset to page 1 on filter change
      router.push(`/pipeline?${params.toString()}`)
    },
    [router, searchParams]
  )

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kc-text-muted" />
        <Input
          placeholder="Search by company or opportunity..."
          defaultValue={currentSearch}
          onChange={(e) => {
            const value = e.target.value
            // Debounce: only update after user stops typing
            const timeout = setTimeout(() => updateParams("q", value), 300)
            return () => clearTimeout(timeout)
          }}
          className="pl-9"
        />
      </div>
      <Select
        value={currentStage || "all"}
        onValueChange={(value) => updateParams("stage", value === "all" ? "" : value)}
      >
        <SelectTrigger className="w-full sm:w-[220px]">
          <SelectValue placeholder="All stages" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All stages</SelectItem>
          {PIPELINE_STAGES.map((stage) => (
            <SelectItem key={stage} value={stage}>
              {stage}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 2: Create pipeline table**

Create `frontend/src/components/pipeline/pipeline-table.tsx`:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Mail, ChevronLeft, ChevronRight } from "lucide-react"
import { StageBadge } from "./stage-badge"
import { UrgencyDot } from "./urgency-dot"
import { EmptyState } from "@/components/dashboard/empty-state"
import { formatCurrency, getUrgencyLevel } from "@/lib/format"
import type { PipelineRow, PipelineResult } from "@/lib/data/pipeline"

interface PipelineTableProps {
  data: PipelineResult
  basePath: string
}

export function PipelineTable({ data, basePath }: PipelineTableProps) {
  const { rows, totalCount, page, pageSize } = data
  const totalPages = Math.ceil(totalCount / pageSize)
  const startRow = (page - 1) * pageSize + 1
  const endRow = Math.min(page * pageSize, totalCount)

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No opportunities found"
        description="Try adjusting your filters or search query"
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-kc-warm-gray-dark/50 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8"></TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={`${row.opportunityId}-${row.contactId}`}
                className="group transition-colors hover:bg-kc-gold-subtle/30"
              >
                <TableCell className="w-8">
                  {row.cadenceThreshold !== null && (
                    <UrgencyDot
                      level={getUrgencyLevel(row.daysSinceLastTouch, row.cadenceThreshold)}
                      daysSinceTouch={row.daysSinceLastTouch}
                      threshold={row.cadenceThreshold}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium text-kc-charcoal">
                    {row.contactName}
                  </p>
                  {row.contactTitle && (
                    <p className="text-xs text-kc-text-muted">{row.contactTitle}</p>
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-sm text-kc-charcoal">{row.accountName}</p>
                  <p className="text-xs text-kc-text-muted truncate max-w-[200px]">
                    {row.opportunityName}
                  </p>
                </TableCell>
                <TableCell>
                  <StageBadge stage={row.stageName} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(row.amount)}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Draft
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-kc-text-muted">
            Showing {startRow}–{endRow} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              asChild={page > 1}
            >
              {page > 1 ? (
                <a href={`${basePath}?page=${page - 1}`}>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </a>
              ) : (
                <span>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </span>
              )}
            </Button>
            <span className="text-sm text-kc-text-muted">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              asChild={page < totalPages}
            >
              {page < totalPages ? (
                <a href={`${basePath}?page=${page + 1}`}>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </a>
              ) : (
                <span>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add frontend/src/components/pipeline/ && git commit -m "feat: add pipeline table with pagination and filter components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire Pipeline Page

**Files:**
- Modify: `frontend/src/app/(app)/pipeline/page.tsx`

- [ ] **Step 1: Update pipeline page**

Overwrite `frontend/src/app/(app)/pipeline/page.tsx`:

```tsx
import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { getPipelineData } from "@/lib/data/pipeline"
import { PipelineTable } from "@/components/pipeline/pipeline-table"
import { PipelineFilters } from "@/components/pipeline/pipeline-filters"
import PipelineLoading from "./loading"

interface PipelinePageProps {
  searchParams: Promise<{
    page?: string
    stage?: string
    q?: string
  }>
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const repEmail = user?.email ?? ""
  const page = parseInt(params.page ?? "1", 10)
  const stageFilter = params.stage ?? ""
  const search = params.q ?? ""

  const data = await getPipelineData(repEmail, {
    page,
    pageSize: 25,
    stageFilter: stageFilter || undefined,
    search: search || undefined,
  })

  // Build base path preserving current filters for pagination links
  const filterParams = new URLSearchParams()
  if (stageFilter) filterParams.set("stage", stageFilter)
  if (search) filterParams.set("q", search)
  const basePath = `/pipeline${filterParams.toString() ? `?${filterParams.toString()}&` : "?"}`

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Pipeline</h1>
        <p className="mt-1 text-kc-text-muted">
          {data.totalCount} opportunities
        </p>
      </div>

      <Suspense fallback={<PipelineLoading />}>
        <PipelineFilters />
        <PipelineTable data={data} basePath={basePath} />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach/frontend && npm run build 2>&1 | tail -15
```

Expected: `/pipeline` is `ƒ` (dynamic)

- [ ] **Step 3: Commit**

```bash
cd /Users/alexgold-keychain/Documents/GitHub/keychain-outreach && git add "frontend/src/app/(app)/pipeline/page.tsx" && git commit -m "feat: wire pipeline page with data fetching, filters, and pagination

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Stage 4 Completion Checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `/pipeline` shows "Pipeline" heading with opportunity count
- [ ] Search input and stage dropdown filter render
- [ ] Table shows contact name, company, stage badge, amount
- [ ] Active stage rows sort before early-stage rows
- [ ] Draft button appears on hover
- [ ] Pagination shows when >25 results
- [ ] Empty state shows for no-match filters
- [ ] All data queries wrapped in `Sentry.startSpan`
