import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { formatTimestamp } from "../../_components/format"
import { ReceiptsList, type Receipt } from "../../_components/receipts-list"

export const dynamic = "force-dynamic"

type SearchParams = {
  id?: string | string[]
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ComposeDonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireUser()
  const sp = await searchParams
  const idParam = Array.isArray(sp.id) ? sp.id[0] : sp.id

  if (!idParam || !UUID_RE.test(idParam)) {
    redirect("/reports/communications/compose")
  }

  const supabase = await createClient()

  const { data: message } = await supabase
    .from("communication_messages")
    .select("id, subject, sent_at, requires_acknowledgement, facility_id")
    .eq("id", idParam)
    .maybeSingle()

  if (!message) {
    redirect("/reports/communications/compose")
  }

  // Per-recipient receipts. RLS (mig 170) lets the message's sender read its
  // recipient rows; for anyone else this select returns only their own row.
  type ReceiptRow = {
    id: string
    read_at: string | null
    acknowledged_at: string | null
    employee: { first_name: string | null; last_name: string | null } | null
  }
  const { data: receiptRowsRaw } = await supabase
    .from("communication_recipients")
    .select(
      "id, read_at, acknowledged_at, employee:employees!communication_recipients_employee_id_fkey(first_name, last_name)",
    )
    .eq("message_id", message.id)
    .order("created_at", { ascending: true })

  const receipts: Receipt[] = (
    (receiptRowsRaw ?? []) as unknown as ReceiptRow[]
  ).map((r) => {
    const name = r.employee
      ? `${r.employee.first_name ?? ""} ${r.employee.last_name ?? ""}`.trim()
      : ""
    return {
      recipientId: r.id,
      name: name.length > 0 ? name : "Unknown employee",
      read_at: r.read_at,
      acknowledged_at: r.acknowledged_at,
    }
  })

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", message.facility_id)
    .maybeSingle()

  const tz = facility?.timezone ?? null
  const count = receipts.length

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div
            aria-hidden
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sent</h1>
          <p className="text-sm text-muted-foreground">
            Sent to {count} recipient{count === 1 ? "" : "s"}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-6 text-sm">
          <DetailRow
            label="Subject"
            value={
              message.subject && message.subject.trim().length > 0
                ? message.subject
                : "(No subject)"
            }
          />
          <DetailRow label="Recipients" value={String(count)} />
          <DetailRow
            label="Sent"
            value={formatTimestamp(message.sent_at, tz)}
          />
          <DetailRow
            label="Acknowledgement"
            value={message.requires_acknowledgement ? "Required" : "Not required"}
          />
        </CardContent>
      </Card>

      <ReceiptsList
        receipts={receipts}
        requiresAck={message.requires_acknowledgement}
        timezone={tz}
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 w-full text-base sm:flex-1">
          <Link href="/reports/communications/compose">Send another</Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-12 w-full text-base sm:flex-1"
        >
          <Link href="/reports/communications">Back to inbox</Link>
        </Button>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
