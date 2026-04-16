import "server-only"

import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/server"
import type {
  PipelineContact,
  BriefingStats,
  ActivityLog,
  UpcomingMeeting,
} from "@/lib/types"

/** Fetch contacts that are overdue for follow-up for the current user */
export async function getOverdueContacts(repEmail: string): Promise<PipelineContact[]> {
  return Sentry.startSpan({ name: "dashboard.getOverdueContacts", op: "db.query" }, async () => {
    const supabase = await createClient()

    const { data: opportunities, error } = await supabase
      .from("opportunities")
      .select(`
        *,
        opportunity_contacts(
          primary,
          contacts(*)
        )
      `)
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null)

    if (error) {
      Sentry.captureException(error)
      return []
    }

    if (!opportunities) return []

    const oppIds = opportunities.map(o => o.id)

    // One round-trip for cadence rules and latest activity per opp
    const [cadenceResult, activityResult] = await Promise.all([
      supabase.from("cadence_rules").select("*"),
      oppIds.length > 0
        ? supabase
            .from("activity_log")
            .select("*")
            .in("opportunity_id", oppIds)
            .order("activity_date", { ascending: false })
        : Promise.resolve({ data: [] as ActivityLog[], error: null }),
    ])

    // Surface per-query errors to Sentry instead of silently falling through
    // to empty maps — which previously caused us to drop every overdue
    // contact whenever either query failed.
    if (cadenceResult.error) {
      Sentry.captureException(
        new Error(`cadence_rules query failed: ${cadenceResult.error.message}`),
      )
    }
    if (activityResult.error) {
      Sentry.captureException(
        new Error(`activity_log query failed: ${activityResult.error.message}`),
      )
    }

    const cadenceMap = new Map((cadenceResult.data ?? []).map(r => [r.stage_name, r]))
    const latestActivityByOpp = new Map<string, ActivityLog>()
    for (const activity of activityResult.data ?? []) {
      if (!latestActivityByOpp.has(activity.opportunity_id)) {
        latestActivityByOpp.set(activity.opportunity_id, activity)
      }
    }

    const now = new Date()
    const results: PipelineContact[] = []

    for (const opp of opportunities) {
      const cadence = cadenceMap.get(opp.stage_name)
      if (!cadence) continue

      const lastActivity = latestActivityByOpp.get(opp.id) ?? null

      const daysSinceLastTouch = lastActivity
        ? Math.floor((now.getTime() - new Date(lastActivity.activity_date).getTime()) / (1000 * 60 * 60 * 24))
        : null

      const threshold = cadence.days_between_touches
      const isOverdue = daysSinceLastTouch === null || daysSinceLastTouch > threshold
      const isAtThreshold = daysSinceLastTouch === threshold

      if (!isOverdue && !isAtThreshold) continue

      const oppContacts = opp.opportunity_contacts ?? []
      const primaryContact = oppContacts.find((oc: { primary: boolean }) => oc.primary)
      const contact = primaryContact?.contacts ?? oppContacts[0]?.contacts

      if (!contact) continue

      results.push({
        contact,
        opportunity: opp,
        isPrimary: primaryContact?.primary ?? false,
        daysSinceLastTouch,
        cadenceThreshold: threshold,
        lastActivity: lastActivity ?? null,
        suggestedAction: cadence.suggested_action,
        isOverdue,
        isAtThreshold,
      })
    }

    // Sort: most overdue first (null = never contacted = most urgent)
    results.sort((a, b) => {
      if (a.daysSinceLastTouch === null) return -1
      if (b.daysSinceLastTouch === null) return 1
      return b.daysSinceLastTouch - a.daysSinceLastTouch
    })

    return results
  })
}

/** Fetch pending drafts */
export async function getPendingDrafts(repEmail: string): Promise<ActivityLog[]> {
  return Sentry.startSpan({ name: "dashboard.getPendingDrafts", op: "db.query" }, async () => {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("rep_email", repEmail)
      .not("draft_copy", "is", null)
      .not("activity_type", "eq", "email_sent")
      .order("created_at", { ascending: false })
      .limit(10)

    if (error) {
      Sentry.captureException(error)
      return []
    }

    return data ?? []
  })
}

/** Fetch upcoming meetings for this week */
export async function getUpcomingMeetings(repEmail: string): Promise<UpcomingMeeting[]> {
  return Sentry.startSpan({ name: "dashboard.getUpcomingMeetings", op: "db.query" }, async () => {
    const supabase = await createClient()

    const now = new Date()
    const endOfWeek = new Date(now)
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()))

    const { data, error } = await supabase
      .from("upcoming_meetings")
      .select("*")
      .eq("rep_email", repEmail)
      .gte("meeting_date", now.toISOString())
      .lte("meeting_date", endOfWeek.toISOString())
      .order("meeting_date", { ascending: true })

    if (error) {
      Sentry.captureException(error)
      return []
    }

    return data ?? []
  })
}

/** Get summary stats for the briefing header */
export async function getBriefingStats(
  overdueContacts: PipelineContact[],
  pendingDrafts: ActivityLog[],
  upcomingMeetings: UpcomingMeeting[],
  repEmail: string
): Promise<BriefingStats> {
  return Sentry.startSpan({ name: "dashboard.getBriefingStats", op: "db.query" }, async () => {
    const supabase = await createClient()

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { count } = await supabase
      .from("activity_log")
      .select("*", { count: "exact", head: true })
      .eq("rep_email", repEmail)
      .gte("activity_date", today.toISOString())

    return {
      overdueCount: overdueContacts.length,
      pendingDraftsCount: pendingDrafts.length,
      meetingsThisWeek: upcomingMeetings.length,
      activitiesToday: count ?? 0,
    }
  })
}
