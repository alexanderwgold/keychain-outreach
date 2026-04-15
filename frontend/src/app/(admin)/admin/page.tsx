import { createClient } from "@/lib/supabase/server"
import { getAdminStats } from "@/lib/data/admin"
import { AdminStatsHeader } from "@/components/admin/admin-stats-header"
import { RepActivityTable } from "@/components/admin/rep-activity-table"
import { StageBreakdownCard } from "@/components/admin/stage-breakdown"

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const stats = await getAdminStats()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Team Dashboard</h1>
        <p className="mt-1 text-kc-text-muted">
          Overview of team activity and pipeline
        </p>
      </div>

      <AdminStatsHeader stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RepActivityTable activities={stats.repActivities} />
        <StageBreakdownCard stages={stats.stageBreakdown} totalOpportunities={stats.totalOpportunities} />
      </div>
    </div>
  )
}
