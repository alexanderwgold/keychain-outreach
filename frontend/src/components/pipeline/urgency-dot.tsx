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
      <TooltipTrigger render={<span className="relative flex h-3 w-3" aria-label={label} />}>
        {level === "overdue" && (
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", URGENCY_COLORS[level])} />
        )}
        <span className={cn("relative inline-flex h-3 w-3 rounded-full", URGENCY_COLORS[level])} />
      </TooltipTrigger>
      <TooltipContent side="right">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}
