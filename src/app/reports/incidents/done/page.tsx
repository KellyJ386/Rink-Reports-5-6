import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { IncidentStatus } from "../types"

type SearchParams = {
  id?: string | string[]
}

type SubmissionRow = {
  id: string
  submitted_at: string
  occurred_at: string
  location: string | null
  status: string
  facility_id: string
  reporter_name: string
  incident_types: { name: string } | null
  incident_severity_levels: { display_name: string } | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function formatTimestamp(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

function statusLabel(status: string): string {
  const map: Record<IncidentStatus, string> = {
    submitted: "Submitted",
    in_review: "In review",
    resolved: "Resolved",
    archived: "Archived",
  }
  return map[status as IncidentStatus] ?? status
}

export default async function IncidentDonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireUser()
  const sp = await searchParams
  const idParam = Array.isArray(sp.id) ? sp.id[0] : sp.id

  if (!idParam || !UUID_RE.test(idParam)) {
    redirect("/reports/incidents")
  }

  const supabase = await createClient()

  const { data: submissionRaw } = await supabase
    .from("incident_reports")
    .select(
      "id, submitted_at, occurred_at, location, status, facility_id, reporter_name, incident_types(name), incident_severity_levels(display_name)"
    )
    .eq("id", idParam)
    .maybeSingle()

  const submission = submissionRaw as unknown as SubmissionRow | null

  if (!submission) {
    redirect("/reports/incidents")
  }

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", submission.facility_id)
    .maybeSingle()

  const tz = facility?.timezone ?? null
  const typeName = submission.incident_types?.name ?? "—"
  const severityName = submission.incident_severity_levels?.display_name ?? "—"

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
          <h1 className="text-2xl font-semibold tracking-tight">Reported</h1>
          <p className="text-sm text-muted-foreground">
            Thank you, {submission.reporter_name}. Your report has been
            submitted.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-6 text-sm">
          <DetailRow
            label="Status"
            value={statusLabel(submission.status)}
          />
          <DetailRow label="Type" value={typeName} />
          <DetailRow label="Severity" value={severityName} />
          <DetailRow
            label="When it happened"
            value={formatTimestamp(submission.occurred_at, tz)}
          />
          <DetailRow
            label="Submitted"
            value={formatTimestamp(submission.submitted_at, tz)}
          />
          {submission.location ? (
            <DetailRow label="Location" value={submission.location} />
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 w-full text-base sm:flex-1">
          <Link href="/reports/incidents">Submit another</Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-12 w-full text-base sm:flex-1"
        >
          <Link href="/reports">Back to home</Link>
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
