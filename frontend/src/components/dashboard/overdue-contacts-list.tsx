import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Mail } from "lucide-react"
import { StageBadge } from "@/components/pipeline/stage-badge"
import { UrgencyDot } from "@/components/pipeline/urgency-dot"
import { EmptyState } from "./empty-state"
import { formatDaysAgo, getUrgencyLevel } from "@/lib/format"
import type { PipelineContact } from "@/lib/types"

interface OverdueContactsListProps {
  contacts: PipelineContact[]
}

export function OverdueContactsList({ contacts }: OverdueContactsListProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-kc-danger" />
          Contacts Due for Follow-up
          {contacts.length > 0 && (
            <span className="font-mono text-sm text-kc-text-muted">
              ({contacts.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <EmptyState
            title="You're all caught up"
            description="No contacts are overdue for follow-up right now"
          />
        ) : (
          <div className="space-y-2">
            {contacts.slice(0, 10).map((item) => (
              <div
                key={`${item.opportunity.id}-${item.contact.id}`}
                className="flex items-center gap-3 rounded-lg border border-kc-warm-gray-dark/30 bg-white p-3 transition-colors hover:border-kc-gold/30 hover:bg-kc-gold-subtle/30"
              >
                <UrgencyDot
                  level={getUrgencyLevel(item.daysSinceLastTouch, item.cadenceThreshold)}
                  daysSinceTouch={item.daysSinceLastTouch}
                  threshold={item.cadenceThreshold}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-kc-charcoal truncate">
                      {item.contact.first_name} {item.contact.last_name}
                    </p>
                    <StageBadge stage={item.opportunity.stage_name} />
                  </div>
                  <p className="text-xs text-kc-text-muted truncate">
                    {item.opportunity.account_name}
                    {item.contact.title && ` · ${item.contact.title}`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs font-medium text-kc-danger">
                    {formatDaysAgo(item.daysSinceLastTouch)}
                  </p>
                  {item.suggestedAction && (
                    <p className="mt-0.5 text-xs text-kc-text-muted truncate max-w-[150px]">
                      {item.suggestedAction}
                    </p>
                  )}
                </div>

                <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-kc-gold/50 text-kc-charcoal hover:bg-kc-gold/10">
                  <Mail className="h-3.5 w-3.5" />
                  Draft
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
