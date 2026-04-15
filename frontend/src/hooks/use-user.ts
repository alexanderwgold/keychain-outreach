"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import * as Sentry from "@sentry/nextjs"
import type { User } from "@supabase/supabase-js"

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)

      if (user) {
        Sentry.setUser({ id: user.id, email: user.email ?? undefined })
      } else {
        Sentry.setUser(null)
      }
    }

    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const sessionUser = session?.user ?? null
        setUser(sessionUser)

        if (sessionUser) {
          Sentry.setUser({ id: sessionUser.id, email: sessionUser.email ?? undefined })
        } else {
          Sentry.setUser(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading }
}
