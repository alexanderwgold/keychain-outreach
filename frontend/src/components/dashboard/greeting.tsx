"use client"

import { useEffect, useState } from "react"

function computeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

/**
 * Renders a time-of-day greeting based on the viewer's local timezone.
 * Uses a TZ-neutral "Welcome" on the server / initial client render to
 * avoid hydration mismatches, then swaps in the real greeting in an effect.
 */
export function Greeting() {
  const [greeting, setGreeting] = useState("Welcome")

  useEffect(() => {
    setGreeting(computeGreeting())
  }, [])

  return <>{greeting}</>
}
