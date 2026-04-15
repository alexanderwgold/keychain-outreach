import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail } from "lucide-react"
import { EmptyState } from "./empty-state"
import type { ActivityLog } from "@/lib/types"

interface PendingDraftsListProps {
  drafts: ActivityLog[]
}

export function PendingDraftsList({ drafts }: PendingDraftsListProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-kc-warning" />
          Drafts Awaiting Send
          {drafts.length > 0 && (
            <span className="font-mono text-sm text-kc-text-muted">
              ({drafts.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {drafts.length === 0 ? (
          <EmptyState
            title="No pending drafts"
            description="Drafted emails will appear here once the daily scan runs"
          />
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center gap-3 rounded-lg border border-kc-warm-gray-dark/30 bg-white p-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kc-warning/10">
                  <Mail className="h-4 w-4 text-kc-warning" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-kc-charcoal truncate">
                    {draft.subject ?? "Untitled draft"}
                  </p>
                  <p className="text-xs text-kc-text-muted">
                    Created {new Date(draft.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
