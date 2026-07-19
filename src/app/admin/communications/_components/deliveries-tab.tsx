"use client"

// Failed-delivery triage (I3 from the 360 review): terminally-failed email
// sends (communication_recipients.email_status = 'failed' after the backoff
// ladder is exhausted) and failed notification_outbox rows, with a manual
// retry that re-queues them for the next cron drain.

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LocalDateTime } from "@/components/app/local-datetime"

import { retryFailedEmail, retryFailedOutboxRow } from "../actions"

export type FailedRecipientItem = {
  id: string
  employee_name: string
  subject: string
  email_attempts: number
  email_error: string | null
  created_at: string
}

export type FailedOutboxItem = {
  id: string
  recipient_name: string
  subject: string | null
  error: string | null
  scheduled_for: string
  created_at: string
}

function ErrorCell({ text }: { text: string | null }) {
  if (!text) return <span className="text-muted-foreground">—</span>
  return (
    <span className="text-destructive block max-w-md truncate" title={text}>
      {text}
    </span>
  )
}

function RetryButton({
  onRetry,
}: {
  onRetry: () => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<"idle" | "queued" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)

  if (state === "queued") {
    return <span className="text-muted-foreground text-sm">Re-queued ✓</span>
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await onRetry()
            if (result.ok) {
              setState("queued")
            } else {
              setState("error")
              setMessage(result.error)
            }
          })
        }
      >
        {pending ? "Re-queuing…" : "Retry"}
      </Button>
      {state === "error" && message ? (
        <span className="text-destructive text-xs">{message}</span>
      ) : null}
    </span>
  )
}

export function DeliveriesTab({
  failedRecipients,
  failedOutbox,
}: {
  failedRecipients: FailedRecipientItem[]
  failedOutbox: FailedOutboxItem[]
}) {
  const empty = failedRecipients.length === 0 && failedOutbox.length === 0

  if (empty) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No failed deliveries</CardTitle>
          <CardDescription>
            Every email delivery and queued notification has either sent,
            been skipped, or is still pending retry. Terminal failures will
            appear here with a manual retry.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Failed email deliveries
          </h2>
          <p className="text-muted-foreground text-sm">
            Sends that exhausted the automatic retry ladder. Retry resets the
            attempt counter and re-queues for the next send run.
          </p>
        </div>
        {failedRecipients.length === 0 ? (
          <p className="text-muted-foreground text-sm">None 🎉</p>
        ) : (
          <div className="overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="border-b px-3 py-2 text-left font-medium">Recipient</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Subject</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Attempts</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Last error</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Queued</th>
                  <th className="border-b px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {failedRecipients.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="border-b px-3 py-2">{r.employee_name}</td>
                    <td className="border-b px-3 py-2">{r.subject}</td>
                    <td className="border-b px-3 py-2">{r.email_attempts}</td>
                    <td className="border-b px-3 py-2">
                      <ErrorCell text={r.email_error} />
                    </td>
                    <td className="border-b px-3 py-2 whitespace-nowrap">
                      <LocalDateTime iso={r.created_at} />
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      <RetryButton onRetry={() => retryFailedEmail(r.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Failed queued notifications
          </h2>
          <p className="text-muted-foreground text-sm">
            Scheduled notifications the drain marked failed. Retry re-queues
            them for the next drain run.
          </p>
        </div>
        {failedOutbox.length === 0 ? (
          <p className="text-muted-foreground text-sm">None 🎉</p>
        ) : (
          <div className="overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="border-b px-3 py-2 text-left font-medium">Recipient</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Subject</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Error</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Scheduled</th>
                  <th className="border-b px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {failedOutbox.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="border-b px-3 py-2">{o.recipient_name}</td>
                    <td className="border-b px-3 py-2">{o.subject ?? "—"}</td>
                    <td className="border-b px-3 py-2">
                      <ErrorCell text={o.error} />
                    </td>
                    <td className="border-b px-3 py-2 whitespace-nowrap">
                      <LocalDateTime iso={o.scheduled_for} />
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      <RetryButton onRetry={() => retryFailedOutboxRow(o.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
