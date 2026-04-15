import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GitBranch } from "lucide-react"
import { StageBadge } from "@/components/pipeline/stage-badge"
import type { StageBreakdown } from "@/lib/data/admin"

interface StageBreakdownProps {
  stages: StageBreakdown[]
  totalOpportunities: number
}

export function StageBreakdownCard({ stages, totalOpportunities }: StageBreakdownProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4 text-kc-gold-dark" />
          Pipeline by Stage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stages.map(({ stageName, count }) => {
            const pct = totalOpportunities > 0 ? (count / totalOpportunities) * 100 : 0
            return (
              <div key={stageName} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <StageBadge stage={stageName} />
                  <span className="text-sm font-medium text-kc-charcoal">
                    {count.toLocaleString()}
                    <span className="ml-1 text-xs text-kc-text-muted">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-kc-warm-gray">
                  <div
                    className="h-full rounded-full bg-kc-gold transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
