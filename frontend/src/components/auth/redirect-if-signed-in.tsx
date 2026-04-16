"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/client"

export function RedirectIfSignedIn({ to }: { to: string }) {
  const router = useRouter()

  useEffect(() => {
    let aborted = false
    const supabase = createClient()
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (aborted) return
        if (error) {
          Sentry.captureException(error)
          return
        }
        if (data.session) router.replace(to)
      })
      .catch((err) => {
        if (aborted) return
        Sentry.captureException(err)
      })
    return () => {
      aborted = true
    }
  }, [router, to])

  return null
}
