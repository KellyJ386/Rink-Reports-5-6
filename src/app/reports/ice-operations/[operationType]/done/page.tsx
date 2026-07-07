import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {

  OPERATION_LABELS,
  isOperationType,
  type OperationType,
} from "../../types"

export const dynamic = "force-dynamic"

type SearchParams = {
  id?: string | string[]
}

type RouteParams = {
  operationType: string
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

type SubmissionRow = {
  id: string
  operation_type: string
  occurred_at: string
  submitted_at: string
  facility_id: string
  has_failed_check: boolean
  failed_count: number
  ice_operations_rinks: { name: string } | null
  ice_operations_equipment: { name: string } | null
  employees: { first_name: string | null; last_name: string | null } | null
}

export default async function IceOperationsDonePage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>
  searchParams: Promise<SearchParams>
}) {
  const [{ operationType: opTypeRaw }, sp] = await Promise.all([
    params,
    searchParams,
  ])

  if (!isOperationType(opTypeRaw)) {
    redirect("/reports/ice-operations")
  }
  const operationType = opTypeRaw as OperationType

  await requireUser()

  const idParam = Array.isArray(sp.id) ? sp.id[0] : sp.id
  if (!idParam || !UUID_RE.test(idParam)) {
    redirect("/reports/ice-operations")
  }

  const supabase = await createClient()

  const { data: submissionRaw } = await supabase
    .from("ice_operations_submissions")
    .select(
      "id, operation_type, occurred_at, submitted_at, facility_id, has_failed_check, failed_count, ice_operations_rinks(name), ice_operations_equipment(name), employees(first_name, last_name)"
    )
    .eq("id", idParam)
    .maybeSingle()

  const submission = submissionRaw as unknown as SubmissionRow | null

  if (!submission || submission.operation_type !== operationType) {
    redirect("/reports/ice-operations")
  }

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", submission.facility_id)
    .maybeSingle()
  const tz = facility?.timezone ?? null

  const rinkName = submission.ice_operations_rinks?.name ?? "—"
  const equipmentName = submission.ice_operations_equipment?.name ?? "—"
  const employeeName = (() => {
    const first = submission.employees?.first_name ?? ""
    const last = submission.employees?.last_name ?? ""
    const full = `${first} ${last}`.trim()
    return full || "—"
  })()

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
          <h1 className="text-2xl font-semibold tracking-tight">Submitted!</h1>
          <p className="text-sm text-muted-foreground">
            {OPERATION_LABELS[operationType]}
          </p>
          {operationType === "circle_check" && submission.failed_count > 0 ? (
            <span className="rounded-full bg-destructive-soft px-3 py-1 text-xs font-medium text-destructive-soft-foreground">
              {submission.failed_count} failed item
              {submission.failed_count === 1 ? "" : "s"}
            </span>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-6 text-sm">
          <DetailRow
            label="When it happened"
            value={formatTimestamp(submission.occurred_at, tz)}
          />
          <DetailRow
            label="Submitted"
            value={formatTimestamp(submission.submitted_at, tz)}
          />
          <DetailRow label="Rink" value={rinkName} />
          <DetailRow label="Equipment" value={equipmentName} />
          <DetailRow label="Submitted by" value={employeeName} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 w-full text-base sm:flex-1">
          <Link href="/reports/ice-operations">Submit another</Link>
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
