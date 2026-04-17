import { cn } from "@/lib/utils"
import { getStageColor, withAlpha } from "@/lib/stage-styles"

interface StageBadgeProps {
  stage: string
  className?: string
  /** Render a larger, bolder version — for the chart legend. */
  size?: "sm" | "md"
}

export function StageBadge({ stage, className, size = "sm" }: StageBadgeProps) {
  const color = getStageColor(stage)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px] leading-4" : "px-2.5 py-1 text-xs leading-4",
        className
      )}
      style={{
        backgroundColor: withAlpha(color, 0.10),
        borderColor: withAlpha(color, 0.30),
        color: "#1C1C1E",
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {stage}
    </span>
  )
}
