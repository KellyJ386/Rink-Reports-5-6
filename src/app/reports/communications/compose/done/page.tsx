import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { formatTimestamp } from "../../_components/format"

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

  const { count: recipientCount } = await supabase
    .from("communication_recipients")
    .select("id", { count: "exact", head: true })
    .eq("message_id", message.id)

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", message.facility_id)
    .maybeSingle()

  const tz = facility?.timezone ?? null
  const count = recipientCount ?? 0

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
