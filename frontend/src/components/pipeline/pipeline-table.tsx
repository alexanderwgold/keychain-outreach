"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button, buttonVariants } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { StageBadge } from "./stage-badge"
import { UrgencyDot } from "./urgency-dot"
import { EmptyState } from "@/components/dashboard/empty-state"
import { DraftTrigger } from "@/components/drafting/draft-trigger"
import { formatCurrency, getUrgencyLevel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PipelineResult } from "@/lib/data/pipeline"

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
              </TableRow>
            ))}
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
