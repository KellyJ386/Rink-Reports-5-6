import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { TimeOffList } from "./_components/time-off-list"

export const dynamic = "force-dynamic"

const STATUS_FILTERS = [
  "pending",
  "approved",
  "denied",
  "cancelled",
  "all",
] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

function asStatus(v: string | undefined): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v ?? "")
    ? (v as StatusFilter)
    : "pending"
}

type SearchParams = Promise<{ status?: string }>

type TimeOffWithEmployee = {
  id: string
  facility_id: string
  employee_id: string
  starts_at: string
  ends_at: string
  reason: string | null
  status: string
  created_at: string
  decided_at: string | null
  decision_note: string | null
  approved_by_employee_id: string | null
  employee: {
    id: string
    first_name: string
    last_name: string
    employee_code: string | null
  } | null
}

export const metadata = { title: "Time Off | MFO / Rink Reports" }

export default async function TimeOffPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null
  const { status: statusRaw } = await searchParams
  const status = asStatus(statusRaw)

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before reviewing time-off requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()

  let query = supabase
    .from("schedule_time_off_requests")
    .select(
      "id, facility_id, employee_id, starts_at, ends_at, reason, status, created_at, decided_at, decision_note, approved_by_employee_id, employee:employees!schedule_time_off_requests_employee_id_fkey(id, first_name, last_name, employee_code)"
    )
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (status !== "all") {
    query = query.eq("status", status)
  }
  const { data: rawRows } = await query

  const rows = (rawRows ?? []) as unknown as TimeOffWithEmployee[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => {
          const active = s === status
          const href = s === "pending" ? "?" : `?status=${s}`
          return (
            <Link
              key={s}
              href={href}
              className={
                active
                  ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                  : "border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm font-medium"
              }
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          )
        })}
      </div>

      <TimeOffList rows={rows} />
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Time-off requests"
      description="Approve, deny, or cancel employee time-off requests."
    />
  )
}
