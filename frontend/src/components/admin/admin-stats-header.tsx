import { Card, CardContent } from "@/components/ui/card"
import { Users, Building2, UserCheck, Activity } from "lucide-react"
import type { AdminStats } from "@/lib/data/admin"

interface AdminStatsHeaderProps {
  stats: AdminStats
}

const STAT_CARDS = [
  { key: "opps", label: "Opportunities", icon: Building2, getValue: (s: AdminStats) => s.totalOpportunities, color: "text-kc-gold-dark", bgColor: "bg-kc-gold/10" },
  { key: "contacts", label: "Contacts", icon: Users, getValue: (s: AdminStats) => s.totalContacts, color: "text-kc-charcoal", bgColor: "bg-kc-warm-gray" },
  { key: "reps", label: "Active Reps", icon: UserCheck, getValue: (s: AdminStats) => s.activeReps, color: "text-kc-success", bgColor: "bg-kc-success/10" },
  { key: "activities", label: "Total Activities", icon: Activity, getValue: (s: AdminStats) => s.totalActivities, color: "text-kc-warning", bgColor: "bg-kc-warning/10" },
] as const

export function AdminStatsHeader({ stats }: AdminStatsHeaderProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {STAT_CARDS.map(({ key, label, icon: Icon, getValue, color, bgColor }) => (
        <Card key={key} className="border-kc-warm-gray-dark/50">
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bgColor}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-kc-charcoal">{getValue(stats).toLocaleString()}</p>
              <p className="text-xs text-kc-text-muted">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
