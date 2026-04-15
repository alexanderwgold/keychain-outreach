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

    let query = supabase
      .from("opportunities")
      .select(`
        id,
        account_name,
        opportunity_name,
        stage_name,
        amount,
        close_date,
        opportunity_contacts(
          primary,
          contacts(id, first_name, last_name, email, title)
        )
      `, { count: "exact" })
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null)

    if (options.stageFilter) {
      query = query.eq("stage_name", options.stageFilter)
    }

    if (options.search) {
      query = query.or(`account_name.ilike.%${options.search}%,opportunity_name.ilike.%${options.search}%`)
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

    const { data: cadenceRules } = await supabase.from("cadence_rules").select("*")
    const cadenceMap = new Map((cadenceRules ?? []).map(r => [r.stage_name, r]))

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

      rows.push({
        opportunityId: opp.id,
        accountName: opp.account_name,
        opportunityName: opp.opportunity_name,
        stageName: opp.stage_name,
        amount: opp.amount,
        closeDate: opp.close_date,
        contactName: `${contact.first_name} ${contact.last_name}`,
        contactEmail: contact.email,
        contactTitle: contact.title,
        contactId: contact.id,
        isPrimary: primaryOc?.primary ?? false,
        isActiveStage: isActive,
        daysSinceLastTouch: null,
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
