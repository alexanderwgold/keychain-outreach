"use client"

import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button, buttonVariants } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react"
import { StageBadge } from "./stage-badge"
import { UrgencyDot } from "./urgency-dot"
import { EmptyState } from "@/components/dashboard/empty-state"
import { DraftTrigger } from "@/components/drafting/draft-trigger"
import { formatCurrency, getUrgencyLevel, formatDaysAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PipelineResult, PipelineRow } from "@/lib/data/pipeline"

interface PipelineTableProps {
  data: PipelineResult
  basePath: string
  repEmail: string
}

export function PipelineTable({ data, basePath, repEmail }: PipelineTableProps) {
  const { rows, totalCount, page, pageSize } = data
  const totalPages = Math.ceil(totalCount / pageSize)
  const startRow = (page - 1) * pageSize + 1
  const endRow = Math.min(page * pageSize, totalCount)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
      <div className="rounded-xl border border-kc-warm-gray-dark/60 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b-kc-warm-gray-dark/60">
              <TableHead className="w-8"></TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Close</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-28"></TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowKey = `${row.opportunityId}-${row.contactId}`
              const isExpanded = expanded.has(rowKey)
              const hasDetails =
                !!row.nextStep ||
                !!row.nextStepsNotes ||
                !!row.description ||
                !!row.categories ||
                !!row.companyCategory

              return (
                <RowGroup
                  key={rowKey}
                  row={row}
                  rowKey={rowKey}
                  isExpanded={isExpanded}
                  hasDetails={hasDetails}
                  onToggle={() => toggleExpand(rowKey)}
                  repEmail={repEmail}
                />
              )
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-kc-text-muted">
            Showing {startRow}–{endRow} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            {page <= 1 ? (
              <Button variant="outline" size="sm" disabled>
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
            ) : (
              <a
                href={`${basePath}page=${page - 1}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </a>
            )}
            <span className="text-sm text-kc-text-muted">
              Page {page} of {totalPages}
            </span>
            {page >= totalPages ? (
              <Button variant="outline" size="sm" disabled>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <a
                href={`${basePath}page=${page + 1}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RowGroup({
  row,
  rowKey,
  isExpanded,
  hasDetails,
  onToggle,
  repEmail,
}: {
  row: PipelineRow
  rowKey: string
  isExpanded: boolean
  hasDetails: boolean
  onToggle: () => void
  repEmail: string
}) {
  return (
    <>
      <TableRow
        data-state={isExpanded ? "expanded" : undefined}
        className={cn(
          "group transition-colors hover:bg-kc-gold-subtle/40",
          isExpanded && "bg-kc-gold-subtle/50 hover:bg-kc-gold-subtle/60"
        )}
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
          <p className="text-sm font-medium text-kc-charcoal">{row.contactName}</p>
          {row.contactTitle && (
            <p className="text-xs text-kc-text-muted">{row.contactTitle}</p>
          )}
        </TableCell>
        <TableCell>
          <p className="text-sm text-kc-charcoal">{row.accountName}</p>
          <p className="text-xs text-kc-text-muted truncate max-w-[220px]">
            {row.opportunityName}
          </p>
        </TableCell>
        <TableCell>
          <StageBadge stage={row.stageName} />
        </TableCell>
        <TableCell className="text-xs text-kc-text-muted whitespace-nowrap">
          {formatCloseDate(row.closeDate)}
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          {formatCurrency(row.amount)}
        </TableCell>
        <TableCell>
          <DraftTrigger
            contactName={row.contactName}
            contactTitle={row.contactTitle}
            contactEmail={row.contactEmail}
            accountName={row.accountName}
            stageName={row.stageName}
            opportunityId={row.opportunityId}
            contactId={row.contactId}
            repEmail={repEmail}
            size="sm"
            variant="ghost"
            className="gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </TableCell>
        <TableCell className="w-8 pr-3">
          {hasDetails ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "Hide details" : "Show details"}
              className="flex h-6 w-6 items-center justify-center rounded-md text-kc-text-muted hover:bg-kc-warm-gray hover:text-kc-charcoal transition-colors"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  isExpanded && "rotate-180"
                )}
              />
            </button>
          ) : (
            <span aria-hidden className="block h-6 w-6" />
          )}
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className="hover:bg-transparent border-b-kc-warm-gray-dark/60">
          <TableCell
            colSpan={8}
            className="bg-kc-warm-gray/35 border-t border-dashed border-kc-warm-gray-dark/60 p-0"
          >
            <RowDetails row={row} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function RowDetails({ row }: { row: PipelineRow }) {
  return (
    <div className="px-5 py-4 animate-in fade-in slide-in-from-top-1 duration-200">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        <DetailField label="Next step" value={row.nextStep} emphasize />
        <DetailField label="Next step notes" value={row.nextStepsNotes} />
        <DetailField label="Description" value={row.description} wide />
        <DetailField label="Company category" value={row.companyCategory} />
        <DetailField label="Categories" value={row.categories} />
        <DetailField
          label="Last touch"
          value={
            row.daysSinceLastTouch === null
              ? "No tracked activity"
              : `${formatDaysAgo(row.daysSinceLastTouch)}${row.cadenceThreshold ? ` · cadence every ${row.cadenceThreshold} days` : ""}`
          }
        />
        {row.suggestedAction && (
          <DetailField label="Suggested action" value={row.suggestedAction} wide />
        )}
      </dl>
    </div>
  )
}

function DetailField({
  label,
  value,
  wide,
  emphasize,
}: {
  label: string
  value: string | null | undefined
  wide?: boolean
  emphasize?: boolean
}) {
  return (
    <div className={cn(wide && "md:col-span-2")}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-kc-text-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 whitespace-pre-wrap text-sm leading-relaxed",
          value ? (emphasize ? "text-kc-charcoal font-medium" : "text-kc-text") : "text-kc-text-muted italic"
        )}
      >
        {value?.trim() || "—"}
      </dd>
    </div>
  )
}

function formatCloseDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
}
