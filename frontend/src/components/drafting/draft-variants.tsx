"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface DraftVariant {
  id: string
  subject: string
  body: string
  angle: "social_proof" | "data" | "pain_point"
}

interface DraftVariantsProps {
  variants: DraftVariant[]
  selectedId: string | null
  onSelect: (variant: DraftVariant) => void
}

const ANGLE_LABELS: Record<DraftVariant["angle"], { label: string; color: string }> = {
  social_proof: { label: "Social Proof", color: "bg-kc-success/10 text-kc-success" },
  data: { label: "Data-Led", color: "bg-kc-gold/15 text-kc-gold-dark" },
  pain_point: { label: "Pain Point", color: "bg-kc-danger/10 text-kc-danger" },
}

export function DraftVariants({ variants, selectedId, onSelect }: DraftVariantsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-kc-text-muted">
        Choose a variant
      </p>
      {variants.map((variant) => {
        const isSelected = variant.id === selectedId
        const angle = ANGLE_LABELS[variant.angle]
        return (
          <Card
            key={variant.id}
            className={cn(
              "cursor-pointer transition-all",
              isSelected
                ? "border-kc-gold bg-kc-gold-subtle/50 ring-1 ring-kc-gold"
                : "border-kc-warm-gray-dark/50 hover:border-kc-gold/30"
            )}
            onClick={() => onSelect(variant)}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-kc-charcoal truncate">{variant.subject}</p>
                <Badge className={cn("shrink-0 text-xs", angle.color)}>{angle.label}</Badge>
              </div>
              <p className="mt-1.5 text-xs text-kc-text-muted line-clamp-2">
                {variant.body.replace(/<[^>]+>/g, "").slice(0, 150)}...
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
