import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const ACTIVE_STAGES = new Set([
  "First Meeting Completed",
  "Second Call Scheduled",
  "Second Meeting Completed",
  "Proposal Meeting Scheduled",
  "Proposal Sent",
  "Next Steps Scheduled",
  "Next Steps Completed",
  "Service Agreement Sent",
]);

export interface OverdueContact {
  contactName: string;
  contactId: string;
  opportunityId: string;
  accountName: string;
  daysSince: number;
  threshold: number;
  isCritical: boolean;
  autoDrafted: boolean;
}

export interface EvalCadenceResult {
  overdue: OverdueContact[];
  error?: string;
}

interface OpportunityRow {
  id: string;
  account_name: string;
  stage_name: string;
  opportunity_contacts?: Array<{
    contacts: { id: string; first_name: string; last_name: string; email: string | null } | null;
  }>;
}

async function evaluateOpp(
  opp: OpportunityRow,
  cadenceMap: Map<string, number>,
  client: SupabaseClient
): Promise<OverdueContact | null> {
  if (!ACTIVE_STAGES.has(opp.stage_name)) return null;

  const threshold = cadenceMap.get(opp.stage_name);
  if (!threshold) return null;

  const { data: lastActivity } = await client
    .from("activity_log")
    .select("activity_date")
    .eq("opportunity_id", opp.id)
    .order("activity_date", { ascending: false })
    .limit(1)
    .single();

  const daysSince = lastActivity
    ? Math.floor((Date.now() - new Date(lastActivity.activity_date).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  if (daysSince < threshold) return null;

  const primaryContact = opp.opportunity_contacts?.[0]?.contacts;
  if (!primaryContact) return null;

  const isCritical = daysSince >= threshold * 2;

  let autoDrafted = false;
  if (isCritical) {
    try {
      const draftUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-draft`;
      const draftResponse = await fetch(draftUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contactId: primaryContact.id,
          opportunityId: opp.id,
          mode: "standard",
          context: {
            trigger: "auto_overdue",
            daysOverdue: daysSince,
            cadenceThreshold: threshold,
          },
        }),
      });

      if (draftResponse.ok) {
        autoDrafted = true;
      }
    } catch (err) {
      console.error(`Auto-draft failed for ${opp.account_name}:`, (err as Error).message);
    }
  }

  return {
    contactName: `${primaryContact.first_name} ${primaryContact.last_name}`,
    contactId: primaryContact.id,
    opportunityId: opp.id,
    accountName: opp.account_name,
    daysSince,
    threshold,
    isCritical,
    autoDrafted,
  };
}

export async function evalCadence(
  repEmail: string,
  client: SupabaseClient
): Promise<EvalCadenceResult> {
  try {
    const { data: opportunities } = await client
      .from("opportunities")
      .select("id, account_name, stage_name, opportunity_contacts(contacts(id, first_name, last_name, email))")
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null);

    if (!opportunities?.length) return { overdue: [] };

    const { data: cadenceRules } = await client.from("cadence_rules").select("*");
    const cadenceMap = new Map(
      (cadenceRules ?? []).map((r: { stage_name: string; days_between_touches: number }) => [
        r.stage_name,
        r.days_between_touches,
      ])
    );

    const results = await Promise.all(
      (opportunities as OpportunityRow[]).map((opp) => evaluateOpp(opp, cadenceMap, client))
    );

    const overdue: OverdueContact[] = [];
    for (const r of results) {
      if (r) overdue.push(r);
    }

    overdue.sort((a, b) => b.daysSince - a.daysSince);

    return { overdue };
  } catch (e) {
    return { overdue: [], error: (e as Error).message };
  }
}
