import { createClient } from "@/lib/supabase/server"
import { BriefingHeader } from "@/components/dashboard/briefing-header"
import { OverdueContactsList } from "@/components/dashboard/overdue-contacts-list"
import { PendingDraftsList } from "@/components/dashboard/pending-drafts-list"
import { UpcomingMeetingsList } from "@/components/dashboard/upcoming-meetings-list"
import {
  getOverdueContacts,
  getPendingDrafts,
  getUpcomingMeetings,
  getBriefingStats,
} from "@/lib/data/dashboard"

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const repEmail = user?.email ?? ""
  const repName = user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "there"

  // Fetch all dashboard data in parallel
  const [overdueContacts, pendingDrafts, upcomingMeetings] = await Promise.all([
    getOverdueContacts(repEmail),
    getPendingDrafts(repEmail),
    getUpcomingMeetings(repEmail),
  ])

  const stats = await getBriefingStats(overdueContacts, pendingDrafts, upcomingMeetings, repEmail)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BriefingHeader repName={repName} stats={stats} />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PendingDraftsList drafts={pendingDrafts} />
          <UpcomingMeetingsList meetings={upcomingMeetings} />
        </div>

        <OverdueContactsList contacts={overdueContacts} repEmail={repEmail} />
      </div>
    </div>
  )
}
