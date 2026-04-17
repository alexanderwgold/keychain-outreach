import "server-only"

import * as Sentry from "@sentry/nextjs"
import { createClient } from "@/lib/supabase/server"
import { ACTIVE_STAGES } from "@/lib/constants"

export interface PipelineRow {
  opportunityId: string
  accountName: string
  opportunityName: string
  stageName: string
  amount: number | null
  closeDate: string | null
  nextStep: string | null
  nextStepsNotes: string | null
  description: string | null
  categories: string | null
  companyCategory: string | null
  contactName: string
  contactEmail: string | null
  contactTitle: string | null
  contactId: string
  isPrimary: boolean
  isActiveStage: boolean
  daysSinceLastTouch: number | null
  cadenceThreshold: number | null
  suggestedAction: string | null
}

export interface PipelineResult {
  rows: PipelineRow[]
  totalCount: number
  page: number
  pageSize: number
}

export interface StageAggregate {
  stageName: string
  count: number
  totalAmount: number
}

// PostgREST's `.or(ilike)` takes a raw filter expression — interpolating user
// search terms verbatim lets commas, parens, and the SQL LIKE wildcards
// (`%`, `_`) change the query shape. Escape everything that's special in
// either PostgREST's filter grammar or LIKE itself.
function escapeIlikeForOr(raw: string): string {
  return raw.replace(/[\\,()%_*]/g, "\\$&")
}

export async function getPipelineData(
  repEmail: string,
  options: {
    page?: number
    pageSize?: number
    stageFilter?: string
    search?: string
  } = {}
): Promise<PipelineResult> {
  return Sentry.startSpan({ name: "pipeline.getPipelineData", op: "db.query" }, async () => {
    const supabase = await createClient()
    const page = options.page ?? 1
    const pageSize = options.pageSize ?? 25
    const offset = (page - 1) * pageSize

    // `opportunity_contacts!inner(...)` forces an inner join so the exact-count
    // only reflects opportunities that actually have a linked contact — the
    // same set we end up rendering. Without it, the count included opps that
    // later got filtered out in-memory, breaking pagination math.
    let query = supabase
      .from("opportunities")
      .select(`
        id,
        account_name,
        opportunity_name,
        stage_name,
        amount,
        close_date,
        next_step,
        next_steps_c,
        description,
        categories,
        company_category,
        opportunity_contacts!inner(
          primary,
          contacts!inner(id, first_name, last_name, email, title)
        )
      `, { count: "exact" })
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null)

    if (options.stageFilter) {
      query = query.eq("stage_name", options.stageFilter)
    }

    if (options.search) {
      const safe = escapeIlikeForOr(options.search)
      query = query.or(`account_name.ilike.%${safe}%,opportunity_name.ilike.%${safe}%`)
    }

    query = query
      .order("account_name", { ascending: true })
      .range(offset, offset + pageSize - 1)

    const { data: opportunities, count, error } = await query

    if (error) {
      Sentry.captureException(error)
      return { rows: [], totalCount: 0, page, pageSize }
    }

    if (!opportunities) return { rows: [], totalCount: 0, page, pageSize }

    const oppIds = opportunities.map(o => o.id)

    const [cadenceResult, activityResult] = await Promise.all([
      supabase.from("cadence_rules").select("*"),
      oppIds.length > 0
        ? supabase
            .from("activity_log")
            .select("opportunity_id, activity_date")
            .in("opportunity_id", oppIds)
            .order("activity_date", { ascending: false })
        : Promise.resolve({ data: [] as { opportunity_id: string; activity_date: string }[] }),
    ])
    const cadenceMap = new Map((cadenceResult.data ?? []).map(r => [r.stage_name, r]))
    const latestActivityByOpp = new Map<string, string>()
    for (const a of activityResult.data ?? []) {
      if (!latestActivityByOpp.has(a.opportunity_id)) {
        latestActivityByOpp.set(a.opportunity_id, a.activity_date)
      }
    }

    const now = Date.now()
    const rows: PipelineRow[] = []

    for (const opp of opportunities) {
      const oppContacts = opp.opportunity_contacts ?? []
      const primaryOc = oppContacts.find((oc: { primary: boolean }) => oc.primary)
      const rawContact = primaryOc?.contacts ?? oppContacts[0]?.contacts
      // Supabase returns joined rows as arrays; normalise to a single object
      const contact = Array.isArray(rawContact) ? rawContact[0] : rawContact

      if (!contact) continue

      const cadence = cadenceMap.get(opp.stage_name)
      const isActive = ACTIVE_STAGES.has(opp.stage_name)
      const lastActivityDate = latestActivityByOpp.get(opp.id)
      const daysSinceLastTouch = lastActivityDate
        ? Math.floor((now - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24))
        : null

      rows.push({
        opportunityId: opp.id,
        accountName: opp.account_name,
        opportunityName: opp.opportunity_name,
        stageName: opp.stage_name,
        amount: opp.amount,
        closeDate: opp.close_date,
        nextStep: opp.next_step ?? null,
        nextStepsNotes: opp.next_steps_c ?? null,
        description: opp.description ?? null,
        categories: opp.categories ?? null,
        companyCategory: opp.company_category ?? null,
        contactName: `${contact.first_name} ${contact.last_name}`,
        contactEmail: contact.email,
        contactTitle: contact.title,
        contactId: contact.id,
        isPrimary: primaryOc?.primary ?? false,
        isActiveStage: isActive,
        daysSinceLastTouch,
        cadenceThreshold: cadence?.days_between_touches ?? null,
        suggestedAction: cadence?.suggested_action ?? null,
      })
    }

    rows.sort((a, b) => {
      if (a.isActiveStage !== b.isActiveStage) return a.isActiveStage ? -1 : 1
      return a.accountName.localeCompare(b.accountName)
    })

    return { rows, totalCount: count ?? 0, page, pageSize }
  })
}

/**
 * Stage-level aggregates across ALL of the rep's opportunities — not filtered
 * by search or stage so the funnel/chart stays stable while the user is
 * drilling into a subset in the table below.
 */
export async function getPipelineStageAggregates(
  repEmail: string
): Promise<StageAggregate[]> {
  return Sentry.startSpan({ name: "pipeline.getPipelineStageAggregates", op: "db.query" }, async () => {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("opportunities")
      .select("stage_name, amount")
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null)

    if (error) {
      Sentry.captureException(error)
      return []
    }

    const byStage = new Map<string, { count: number; totalAmount: number }>()
    for (const row of data ?? []) {
      if (!row.stage_name) continue
      const entry = byStage.get(row.stage_name) ?? { count: 0, totalAmount: 0 }
      entry.count += 1
      entry.totalAmount += Number(row.amount) || 0
      byStage.set(row.stage_name, entry)
    }

    return Array.from(byStage.entries()).map(([stageName, { count, totalAmount }]) => ({
      stageName,
      count,
      totalAmount,
    }))
  })
}
