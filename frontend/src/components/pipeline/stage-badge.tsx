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
