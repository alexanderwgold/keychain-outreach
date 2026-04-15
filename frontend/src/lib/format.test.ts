import { describe, it, expect } from "vitest"
import { formatDaysAgo, formatRelativeDate, getUrgencyLevel } from "./format"
import type { UrgencyLevel } from "./types"

describe("formatDaysAgo", () => {
  it("returns 'Today' for 0 days", () => {
    expect(formatDaysAgo(0)).toBe("Today")
  })

  it("returns 'Yesterday' for 1 day", () => {
    expect(formatDaysAgo(1)).toBe("Yesterday")
  })

  it("returns 'N days ago' for 2+ days", () => {
    expect(formatDaysAgo(5)).toBe("5 days ago")
  })

  it("returns 'Never' for null", () => {
    expect(formatDaysAgo(null)).toBe("Never")
  })
})

describe("getUrgencyLevel", () => {
  it("returns 'healthy' when days < threshold", () => {
    expect(getUrgencyLevel(1, 3)).toBe("healthy")
  })

  it("returns 'at-threshold' when days === threshold", () => {
    expect(getUrgencyLevel(3, 3)).toBe("at-threshold")
  })

  it("returns 'overdue' when days > threshold", () => {
    expect(getUrgencyLevel(5, 3)).toBe("overdue")
  })

  it("returns 'overdue' for null days (never contacted)", () => {
    expect(getUrgencyLevel(null, 3)).toBe("overdue")
  })
})

describe("formatRelativeDate", () => {
  it("formats an ISO date as a short relative string", () => {
    const today = new Date()
    const iso = today.toISOString()
    expect(formatRelativeDate(iso)).toBe("Today")
  })

  it("returns empty string for null", () => {
    expect(formatRelativeDate(null)).toBe("")
  })
})
