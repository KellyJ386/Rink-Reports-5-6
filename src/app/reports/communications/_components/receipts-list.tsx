import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { formatTimestamp } from "./format"

export type Receipt = {
  recipientId: string
  name: string
  read_at: string | null
  acknowledged_at: string | null
}

/**
 * Per-recipient read/acknowledgement receipts for a message the current user
 * sent. Server-rendered — visibility comes from the mig-170 RLS extension
 * letting a message's sender read its communication_recipients rows.
 */
export function ReceiptsList({
  receipts,
  requiresAck,
  timezone,
}: {
  receipts: Receipt[]
  requiresAck: boolean
  timezone: string | null
}) {
  const readCount = receipts.filter((r) => r.read_at !== null).length
  const ackCount = receipts.filter((r) => r.acknowledged_at !== null).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receipts</CardTitle>
        <CardDescription>
          {readCount} of {receipts.length} read
          {requiresAck ? ` · ${ackCount} of ${receipts.length} acknowledged` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recipients.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {receipts.map((r) => (
              <li
                key={r.recipientId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="font-medium">{r.name}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {r.read_at ? (
                    <Badge
                      variant="info"
                      title={formatTimestamp(r.read_at, timezone)}
                    >
                      Read
                    </Badge>
                  ) : (
                    <Badge variant="neutral">Unread</Badge>
                  )}
                  {requiresAck ? (
                    r.acknowledged_at ? (
                      <Badge
                        variant="success"
                        title={formatTimestamp(r.acknowledged_at, timezone)}
                      >
                        Acknowledged
                      </Badge>
                    ) : (
                      <Badge variant="warning">Awaiting ack</Badge>
                    )
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
