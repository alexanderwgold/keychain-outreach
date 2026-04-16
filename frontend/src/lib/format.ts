import type { UrgencyLevel } from "./types"

/** Human-readable "N days ago" string */
export function formatDaysAgo(days: number | null): string {
  if (days === null) return "Never"
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return `${days} days ago`
}

/** Determine urgency color level based on days since touch vs cadence threshold */
export function getUrgencyLevel(
  daysSinceTouch: number | null,
  threshold: number
): UrgencyLevel {
  if (daysSinceTouch === null) return "overdue"
  if (daysSinceTouch > threshold) return "overdue"
  if (daysSinceTouch === threshold) return "at-threshold"
  return "healthy"
}

/** Format an ISO date string as a short relative date */
export function formatRelativeDate(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (isNaN(date.getTime())) return iso
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return formatDaysAgo(diffDays)
}

/**
 * Short relative date format used for compact inline timestamps:
 * "today" / "yesterday" / "Xd ago" / "Xw ago" / "MMM d".
 * Lower-case and terse — distinct from formatRelativeDate which
 * returns "Today" / "N days ago" sentence case.
 */
export function formatRelativeDateShort(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "today"
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** Format a number with commas: 1234567 → "1,234,567" */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US")
}

/** Format a currency amount: 50000 → "$50,000" */
export function formatCurrency(n: number | null): string {
  if (n === null) return "—"
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
