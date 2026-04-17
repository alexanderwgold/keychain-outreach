import { PIPELINE_STAGES } from "./constants"

/**
 * Per-stage accent color. Progression: cool neutrals (early) → cool greens/blues (mid)
 * → warm violet/pink (proposal) → orange/amber/gold (close). Each stage gets a
 * distinct but cohesive hue so pills, chart bars, and funnel segments share a
 * single visual language.
 */
export const STAGE_COLORS: Record<string, string> = {
  "Scheduling First Call":       "#64748B", // slate
  "Revival":                     "#78716C", // stone (re-engage)
  "First Call Scheduled":        "#0EA5E9", // sky
  "First Meeting Completed":     "#06B6D4", // cyan
  "Second Call Scheduled":       "#14B8A6", // teal
  "Second Meeting Completed":    "#10B981", // emerald
  "Proposal Meeting Scheduled":  "#8B5CF6", // violet
  "Proposal Sent":               "#EC4899", // pink
  "Next Steps Scheduled":        "#F97316", // orange
  "Next Steps Completed":        "#F59E0B", // amber
  "Service Agreement Sent":      "#F5C518", // brand gold
}

const FALLBACK = "#8E8E93"

export function getStageColor(stage: string | null | undefined): string {
  if (!stage) return FALLBACK
  return STAGE_COLORS[stage] ?? FALLBACK
}

export function getStageOrder(stage: string): number {
  const idx = PIPELINE_STAGES.indexOf(stage as (typeof PIPELINE_STAGES)[number])
  return idx === -1 ? 99 : idx
}

/** Hex + alpha helper: "#F5C518" + 0.12 → "rgba(245,197,24,0.12)". */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
