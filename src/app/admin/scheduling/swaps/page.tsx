import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { SwapsList, type SwapEmployeeOption, type SwapRow } from "./_components/swaps-list"

export const dynamic = "force-dynamic"

const STATUS_FILTERS = [
  "open",
  "pending",
  "accepted",
  "manager_approved",
  "denied",
  "cancelled",
  "all",
] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

function asStatus(v: string | undefined): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v ?? "")
    ? (v as StatusFilter)
    : "open"
}

type SearchParams = Promise<{ status?: string }>

type SwapDbRow = {
  id: string
  facility_id: string
  status: string
  requester_employee_id: string
  requester_shift_id: string
  target_employee_id: string | null
  target_shift_id: string | null
  created_at: string
  decision_note: string | null
  decided_at: string | null
  approved_at: string | null
}

type ShiftLite = {
  id: string
  starts_at: string
  ends_at: string
}

type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
  employee_code: string | null
}

export default async function SwapsPage({
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
              Create a facility before reviewing swap requests.
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
    .from("schedule_swap_requests")
    .select(
      "id, facility_id, status, requester_employee_id, requester_shift_id, target_employee_id, target_shift_id, created_at, decision_note, decided_at, approved_at"
    )
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (status === "open") {
    query = query.in("status", ["pending", "accepted"])
  } else if (status !== "all") {
    query = query.eq("status", status)
  }
  const { data: swapsRaw } = await query
  const swaps = (swapsRaw ?? []) as SwapDbRow[]

  // Resolve referenced shifts and employees in batch.
  const shiftIds = Array.from(
    new Set(
      swaps.flatMap((s) =>
        [s.requester_shift_id, s.target_shift_id].filter(
          (v): v is string => typeof v === "string"
        )
      )
    )
  )
  const empIds = Array.from(
    new Set(
      swaps.flatMap((s) =>
        [s.requester_employee_id, s.target_employee_id].filter(
          (v): v is string => typeof v === "string"
        )
      )
    )
  )

  const [shiftsRes, empsRes, facilityEmpsRes] = await Promise.all([
    shiftIds.length > 0
      ? supabase
          .from("schedule_shifts")
          .select("id, starts_at, ends_at")
          .in("id", shiftIds)
      : Promise.resolve({ data: [] as ShiftLite[] }),
    empIds.length > 0
      ? supabase
          .from("employees")
          .select("id, first_name, last_name, employee_code")
          .in("id", empIds)
      : Promise.resolve({ data: [] as EmployeeLite[] }),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true })
      .limit(500),
  ])
  const shiftMap = new Map(
    ((shiftsRes.data ?? []) as ShiftLite[]).map((s) => [s.id, s])
  )
  const empMap = new Map(
    ((empsRes.data ?? []) as EmployeeLite[]).map((e) => [e.id, e])
  )
  const facilityEmps = (facilityEmpsRes.data ?? []) as EmployeeLite[]

  const rows: SwapRow[] = swaps.map((s) => ({
    id: s.id,
    status: s.status,
    created_at: s.created_at,
    decision_note: s.decision_note,
    decided_at: s.decided_at,
    approved_at: s.approved_at,
    requester: {
      employee: empMap.get(s.requester_employee_id) ?? null,
      shift: shiftMap.get(s.requester_shift_id) ?? null,
    },
    target: {
      employee_id: s.target_employee_id,
      employee: s.target_employee_id
        ? empMap.get(s.target_employee_id) ?? null
        : null,
      shift: s.target_shift_id ? shiftMap.get(s.target_shift_id) ?? null : null,
    },
  }))

  const employeeOptions: SwapEmployeeOption[] = facilityEmps.map((e) => ({
    id: e.id,
    label: `${e.last_name}, ${e.first_name}${
      e.employee_code ? ` (${e.employee_code})` : ""
    }`,
  }))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => {
          const active = s === status
          const href = s === "open" ? "?" : `?status=${s}`
          const label =
            s === "open"
              ? "Open"
              : s === "all"
                ? "All"
                : s
                    .split("_")
                    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                    .join(" ")
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
              {label}
            </Link>
          )
        })}
      </div>

      <SwapsList rows={rows} employeeOptions={employeeOptions} />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Swap requests</h1>
      <p className="text-muted-foreground text-sm">
        Approve, deny, or assign targets for shift swaps.
      </p>
    </div>
  )
}
