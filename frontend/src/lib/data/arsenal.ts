import "server-only"

import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/server"
import type { ArsenalItem } from "@/lib/types"

export async function getGlobalArsenalItems(): Promise<ArsenalItem[]> {
  return Sentry.startSpan({ name: "arsenal.getGlobalArsenalItems", op: "db.query" }, async () => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("arsenal_items")
      .select("*")
      .eq("visibility", "global")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })

    if (error) { Sentry.captureException(error); return [] }
    return data ?? []
  })
}

export async function getRepArsenalItems(repEmail: string): Promise<{
  global: ArsenalItem[]
  mine: ArsenalItem[]
}> {
  return Sentry.startSpan({ name: "arsenal.getRepArsenalItems", op: "db.query" }, async () => {
    const supabase = await createClient()
    const [globalRes, mineRes] = await Promise.all([
      supabase.from("arsenal_items").select("*")
        .eq("visibility", "global").eq("active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase.from("arsenal_items").select("*")
        .eq("visibility", "private")
        .eq("owner_email", repEmail)
        .eq("active", true)
        .order("created_at", { ascending: false }),
    ])
    if (globalRes.error) Sentry.captureException(globalRes.error)
    if (mineRes.error) Sentry.captureException(mineRes.error)
    return {
      global: globalRes.data ?? [],
      mine: mineRes.data ?? [],
    }
  })
}
