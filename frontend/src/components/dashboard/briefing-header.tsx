import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle, Mail, Calendar, Activity } from "lucide-react"
import type { BriefingStats } from "@/lib/types"
import { Greeting } from "./greeting"

interface BriefingHeaderProps {
  repName: string
  stats: BriefingStats
}

const STAT_CARDS = [
  {
    key: "overdue" as const,
    label: "Overdue",
    icon: AlertTriangle,
    getValue: (s: BriefingStats) => s.overdueCount,
    color: "text-kc-danger",
    bgColor: "bg-kc-danger/10",
  },
  {
    key: "drafts" as const,
    label: "Pending Drafts",
    icon: Mail,
    getValue: (s: BriefingStats) => s.pendingDraftsCount,
    color: "text-kc-warning",
    bgColor: "bg-kc-warning/10",
  },
  {
    key: "meetings" as const,
    label: "Meetings This Week",
    icon: Calendar,
    getValue: (s: BriefingStats) => s.meetingsThisWeek,
    color: "text-kc-gold-dark",
    bgColor: "bg-kc-gold/10",
  },
  {
    key: "activities" as const,
    label: "Activities Today",
    icon: Activity,
    getValue: (s: BriefingStats) => s.activitiesToday,
    color: "text-kc-success",
    bgColor: "bg-kc-success/10",
  },
] as const

export function BriefingHeader({ repName, stats }: BriefingHeaderProps) {
  const firstName = repName.split(" ")[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">
          <Greeting />, {firstName}
        </h1>
        <p className="mt-1 text-kc-text-muted">
          Here&apos;s your daily briefing
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, getValue, color, bgColor }) => (
          <Card key={key} className="border-kc-warm-gray-dark/50">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bgColor}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <div>
                <p className="font-mono text-2xl font-bold text-kc-charcoal">
                  {getValue(stats)}
                </p>
                <p className="text-xs text-kc-text-muted">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
