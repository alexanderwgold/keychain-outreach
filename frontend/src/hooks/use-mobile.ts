"use client"

import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Initialise to `false` on the server/first client render so SSR markup matches
// the initial client render. The real viewport value is set in the effect —
// this trades a brief flash of the desktop layout for avoiding a hydration
// mismatch, which is the worse failure mode.
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
