import "server-only"

import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/server"

export interface RepActivity {
  repEmail: string
  repName: string
  emailsSent: number
  repliesReceived: number
  meetingsHeld: number
  totalActivities: number
}

export interface StageBreakdown {
  stageName: string
  count: number
}

export interface AdminStats {
  totalOpportunities: number
  totalContacts: number
  activeReps: number
  totalActivities: number
  repActivities: RepActivity[]
  stageBreakdown: StageBreakdown[]
}

export async function getAdminStats(): Promise<AdminStats> {
  return Sentry.startSpan({ name: "admin.getAdminStats", op: "db.query" }, async () => {
    const supabase = await createClient()

    // Run queries in parallel
    const [oppsResult, contactsResult, repsResult, activitiesResult, stageResult] = await Promise.all([
      supabase.from("opportunities").select("*", { count: "exact", head: true }),
      supabase.from("contacts").select("*", { count: "exact", head: true }),
      supabase.from("rep_mapping").select("*").eq("is_active", true),
      supabase.from("activity_log").select("rep_email, activity_type"),
      supabase.from("opportunities").select("stage_name"),
    ])

    // Build rep activity summary
    const reps = repsResult.data ?? []
    const activities = activitiesResult.data ?? []
    const repActivityMap = new Map<string, RepActivity>()

    for (const rep of reps) {
      repActivityMap.set(rep.rep_email, {
        repEmail: rep.rep_email,
        repName: rep.rep_name,
        emailsSent: 0,
        repliesReceived: 0,
        meetingsHeld: 0,
        totalActivities: 0,
      })
    }

    for (const act of activities) {
      const entry = repActivityMap.get(act.rep_email)
      if (!entry) continue
      entry.totalActivities++
      if (act.activity_type === "email_sent") entry.emailsSent++
      if (act.activity_type === "reply_received") entry.repliesReceived++
      if (act.activity_type === "meeting_held") entry.meetingsHeld++
    }

    // Stage breakdown
    const stages = stageResult.data ?? []
    const stageCountMap = new Map<string, number>()
    for (const opp of stages) {
      if (!opp.stage_name) continue
      stageCountMap.set(opp.stage_name, (stageCountMap.get(opp.stage_name) ?? 0) + 1)
    }
    const stageBreakdown = Array.from(stageCountMap.entries())
      .map(([stageName, count]) => ({ stageName, count }))
      .sort((a, b) => b.count - a.count)

    return {
      totalOpportunities: oppsResult.count ?? 0,
      totalContacts: contactsResult.count ?? 0,
      activeReps: reps.length,
      totalActivities: activities.length,
      repActivities: Array.from(repActivityMap.values()).sort((a, b) => b.totalActivities - a.totalActivities),
      stageBreakdown,
    }
  })
}
