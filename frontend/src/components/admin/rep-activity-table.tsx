import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users } from "lucide-react"
import { EmptyState } from "@/components/dashboard/empty-state"
import type { RepActivity } from "@/lib/data/admin"

interface RepActivityTableProps {
  activities: RepActivity[]
}

export function RepActivityTable({ activities }: RepActivityTableProps) {
  return (
    <Card className="border-kc-warm-gray-dark/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-kc-gold-dark" />
          Activity by Rep
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 || activities.every(a => a.totalActivities === 0) ? (
          <EmptyState title="No activity yet" description="Activity will appear here once the daily scan runs" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Rep</TableHead>
                <TableHead className="text-right">Emails Sent</TableHead>
                <TableHead className="text-right">Replies</TableHead>
                <TableHead className="text-right">Meetings</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.filter(a => a.totalActivities > 0).map((rep) => (
                <TableRow key={rep.repEmail}>
                  <TableCell>
                    <p className="text-sm font-medium text-kc-charcoal">{rep.repName}</p>
                    <p className="text-xs text-kc-text-muted">{rep.repEmail}</p>
                  </TableCell>
                  <TableCell className="text-right">{rep.emailsSent}</TableCell>
                  <TableCell className="text-right">{rep.repliesReceived}</TableCell>
                  <TableCell className="text-right">{rep.meetingsHeld}</TableCell>
                  <TableCell className="text-right font-medium">{rep.totalActivities}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
