"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo } from "react"
import { PIPELINE_STAGES, ACTIVE_STAGES } from "@/lib/constants"
import { getStageColor, withAlpha } from "@/lib/stage-styles"
import { formatCurrency, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { StageAggregate } from "@/lib/data/pipeline"

interface PipelineChartProps {
  aggregates: StageAggregate[]
  /** Currently-selected stage filter, or null for "all". */
  activeStage: string | null
}

export function PipelineChart({ aggregates, activeStage }: PipelineChartProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const aggregateByStage = useMemo(() => {
    const map = new Map<string, StageAggregate>()
    for (const a of aggregates) map.set(a.stageName, a)
    return map
  }, [aggregates])

  // Always render all 11 canonical stages in pipeline order so the chart
  // shape is stable even when a stage has zero opportunities.
  const rows = useMemo(
    () =>
      PIPELINE_STAGES.map((stage) => {
        const agg = aggregateByStage.get(stage)
        return {
          stageName: stage,
          count: agg?.count ?? 0,
          totalAmount: agg?.totalAmount ?? 0,
        }
      }),
    [aggregateByStage]
  )

  const maxCount = Math.max(1, ...rows.map((r) => r.count))
  const totalOpps = rows.reduce((s, r) => s + r.count, 0)
  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0)
  const activeTotal = rows
    .filter((r) => ACTIVE_STAGES.has(r.stageName))
    .reduce((s, r) => s + r.count, 0)

  const setStage = useCallback(
    (stage: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (stage) params.set("stage", stage)
      else params.delete("stage")
      params.delete("page")
      const qs = params.toString()
      router.push(qs ? `/pipeline?${qs}` : "/pipeline")
    },
    [router, searchParams]
  )

  return (
    <section
      aria-label="Pipeline overview"
      className="rounded-xl border border-kc-warm-gray-dark/60 bg-white shadow-[0_1px_0_0_rgba(28,28,30,0.02)] overflow-hidden"
    >
      {/* Summary header */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-kc-warm-gray-dark/50 px-5 py-4">
        <div className="flex items-baseline gap-6">
          <SummaryStat label="Total opportunities" value={formatNumber(totalOpps)} />
          <SummaryStat
            label="Active"
            value={formatNumber(activeTotal)}
            hint={totalOpps > 0 ? `${Math.round((activeTotal / totalOpps) * 100)}% of pipeline` : undefined}
          />
          <SummaryStat label="Weighted pipeline" value={formatCurrency(totalAmount)} />
        </div>
        {activeStage && (
          <button
            type="button"
            onClick={() => setStage(null)}
            className="text-xs font-medium text-kc-text-muted hover:text-kc-charcoal transition-colors"
          >
            Clear stage filter ·  Show all
          </button>
        )}
      </div>

      {/* Segmented funnel strip */}
      <FunnelStrip
        rows={rows}
        totalOpps={totalOpps}
        activeStage={activeStage}
        onSelect={setStage}
      />

      {/* Bar chart — one row per stage */}
      <ol className="divide-y divide-kc-warm-gray-dark/40">
        {rows.map((row) => {
          const color = getStageColor(row.stageName)
          const pct = row.count / maxCount
          const isActive = activeStage === row.stageName
          const isDimmed = activeStage !== null && !isActive
          const isEmpty = row.count === 0

          return (
            <li key={row.stageName}>
              <button
                type="button"
                disabled={isEmpty}
                onClick={() => setStage(isActive ? null : row.stageName)}
                className={cn(
                  "group grid w-full grid-cols-[minmax(200px,1.25fr)_minmax(0,3fr)_auto] items-center gap-4 px-5 py-2.5 text-left transition-all",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  !isEmpty && "hover:bg-kc-warm-gray/40 cursor-pointer",
                  isDimmed && "opacity-45",
                  isActive && "bg-kc-gold-subtle"
                )}
              >
                {/* Stage label */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate text-sm text-kc-charcoal font-medium">
                    {row.stageName}
                  </span>
                </div>

                {/* Bar */}
                <div className="relative h-6 min-w-0">
                  <div
                    className="absolute inset-y-0 left-0 rounded-[3px] transition-[width] duration-500 ease-out"
                    style={{
                      width: `${Math.max(pct * 100, row.count > 0 ? 1.5 : 0)}%`,
                      backgroundColor: withAlpha(color, isActive ? 0.9 : 0.75),
                      boxShadow: isActive ? `inset 0 0 0 1px ${withAlpha(color, 0.9)}` : undefined,
                    }}
                  />
                  {/* Baseline hairline for empty stages */}
                  {row.count === 0 && (
                    <div className="absolute inset-x-0 top-1/2 h-px bg-kc-warm-gray-dark/50" />
                  )}
                </div>

                {/* Count + amount */}
                <div className="flex items-baseline gap-3 text-right tabular-nums">
                  <span className="text-sm font-semibold text-kc-charcoal w-7">
                    {row.count}
                  </span>
                  <span className="text-xs text-kc-text-muted min-w-[70px]">
                    {row.totalAmount > 0 ? formatCurrency(row.totalAmount) : "—"}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function SummaryStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-kc-text-muted">
        {label}
      </span>
      <span className="text-xl font-semibold text-kc-charcoal tabular-nums leading-tight">
        {value}
      </span>
      {hint && (
        <span className="text-[11px] text-kc-text-muted mt-0.5">{hint}</span>
      )}
    </div>
  )
}

function FunnelStrip({
  rows,
  totalOpps,
  activeStage,
  onSelect,
}: {
  rows: { stageName: string; count: number }[]
  totalOpps: number
  activeStage: string | null
  onSelect: (stage: string | null) => void
}) {
  if (totalOpps === 0) {
    return (
      <div className="h-2.5 bg-kc-warm-gray" />
    )
  }

  return (
    <div className="px-5 py-3.5 border-b border-kc-warm-gray-dark/50 bg-gradient-to-b from-kc-warm-white to-white">
      <div className="flex h-8 w-full overflow-hidden rounded-md bg-kc-warm-gray">
        {rows.map((row) => {
          if (row.count === 0) return null
          const color = getStageColor(row.stageName)
          const pct = (row.count / totalOpps) * 100
          const isActive = activeStage === row.stageName
          const isDimmed = activeStage !== null && !isActive
          return (
            <button
              key={row.stageName}
              type="button"
              onClick={() => onSelect(isActive ? null : row.stageName)}
              title={`${row.stageName} — ${row.count}`}
              aria-label={`${row.stageName}: ${row.count} opportunities`}
              className={cn(
                "group relative h-full border-r border-white/70 last:border-r-0 transition-opacity",
                isDimmed && "opacity-35"
              )}
              style={{
                width: `${pct}%`,
                backgroundColor: color,
              }}
            >
              {pct > 7 && (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-white/95 drop-shadow-[0_1px_0_rgba(0,0,0,0.15)]">
                  {row.count}
                </span>
              )}
              <span
                className={cn(
                  "absolute inset-x-0 -bottom-px h-[2px] opacity-0 transition-opacity",
                  isActive ? "opacity-100" : "group-hover:opacity-70"
                )}
                style={{ backgroundColor: color }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
