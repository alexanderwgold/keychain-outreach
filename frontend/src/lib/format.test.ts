import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  formatDaysAgo,
  formatRelativeDate,
  formatRelativeDateShort,
  getUrgencyLevel,
} from "./format"

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
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-16T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("formats an ISO date as a short relative string", () => {
    const iso = new Date("2026-04-16T12:00:00Z").toISOString()
    expect(formatRelativeDate(iso)).toBe("Today")
  })

  it("returns empty string for null", () => {
    expect(formatRelativeDate(null)).toBe("")
  })

  it("returns the raw input for a malformed ISO string", () => {
    expect(formatRelativeDate("not-a-date")).toBe("not-a-date")
  })
})

describe("formatRelativeDateShort", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-16T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 'today' for same day", () => {
    expect(formatRelativeDateShort("2026-04-16T12:00:00Z")).toBe("today")
  })

  it("returns 'yesterday' for one day ago", () => {
    expect(formatRelativeDateShort("2026-04-15T12:00:00Z")).toBe("yesterday")
  })

  it("returns 'Xd ago' for under a week", () => {
    expect(formatRelativeDateShort("2026-04-13T12:00:00Z")).toBe("3d ago")
  })

  it("returns 'Xw ago' for 7-29 days", () => {
    expect(formatRelativeDateShort("2026-04-02T12:00:00Z")).toBe("2w ago")
  })

  it("returns 'MMM d' for 30+ days", () => {
    expect(formatRelativeDateShort("2026-03-01T12:00:00Z")).toBe("Mar 1")
  })

  it("returns the raw input for a malformed date", () => {
    expect(formatRelativeDateShort("not-a-date")).toBe("not-a-date")
  })
})
