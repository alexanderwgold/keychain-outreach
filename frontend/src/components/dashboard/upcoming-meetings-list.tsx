import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "./empty-state"
import type { UpcomingMeeting } from "@/lib/types"

interface UpcomingMeetingsListProps {
  meetings: UpcomingMeeting[]
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  intro: "Intro",
  meeting: "Meeting",
  proposal: "Proposal",
  next_steps: "Next Steps",
  catch_up: "Catch-up",
  unknown: "Meeting",
}

export function UpcomingMeetingsList({ meetings }: UpcomingMeetingsListProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4 text-kc-gold-dark" />
          Upcoming Meetings
          {meetings.length > 0 && (
            <span className="font-mono text-sm text-kc-text-muted">
              ({meetings.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {meetings.length === 0 ? (
          <EmptyState
            title="No meetings this week"
            description="Matched meetings will appear here after the weekly scan runs"
          />
        ) : (
          <div className="space-y-2">
            {meetings.map((meeting) => {
              const date = new Date(meeting.meeting_date)
              return (
                <div
                  key={meeting.id}
                  className="flex items-center gap-3 rounded-lg border border-kc-warm-gray-dark/30 bg-white p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-kc-gold/10">
                    <span className="text-xs font-medium uppercase text-kc-gold-dark">
                      {date.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className="font-mono text-sm font-bold text-kc-charcoal">
                      {date.getDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-kc-charcoal truncate">
                      {meeting.meeting_title}
                    </p>
                    <p className="text-xs text-kc-text-muted">
                      {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 border-kc-warm-gray-dark bg-kc-warm-gray text-kc-text-muted">
                    {MEETING_TYPE_LABELS[meeting.inferred_type] ?? "Meeting"}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
