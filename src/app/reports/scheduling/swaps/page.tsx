import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { formatDateRange, formatDateTime } from "../_components/format-utils"
import {
  SwapAcceptButton,
  SwapCancelButton,
} from "../_components/swap-action-button"
import { SwapForm } from "../_components/swap-form"
import type { SwapStatus } from "../types"

export const dynamic = "force-dynamic"

function NotAvailable({
  title,
  description,
  showSignOut = false,
}: {
  title: string
  description: string
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / Swaps
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}

function statusBadgeVariant(status: string): BadgeProps["variant"] {
  switch (status) {
    case "applied":
    case "manager_approved":
    case "accepted":
      return "success"
    case "denied":
    case "expired":
      return "error"
    case "cancelled":
      return "outline"
    default:
      return "warning"
  }
}

function statusLabel(status: string): string {
  const map: Record<SwapStatus, string> = {
    pending: "Pending",
    accepted: "Accepted",
    manager_approved: "Manager approved",
    applied: "Applied",
    cancelled: "Cancelled",
    denied: "Denied",
    expired: "Expired",
  }
  return map[status as SwapStatus] ?? status
}

type SwapJoinRow = {
  id: string
  status: string
  decision_note: string | null
  created_at: string
  requester_employee_id: string
  target_employee_id: string | null
  requester: { first_name: string | null; last_name: string | null } | null
  target: { first_name: string | null; last_name: string | null } | null
  requester_shift: {
    id: string
    starts_at: string
    ends_at: string
    role_label: string | null
  } | null
  target_shift: {
    id: string
    starts_at: string
    ends_at: string
    role_label: string | null
  } | null
}

function fullName(
  emp: { first_name: string | null; last_name: string | null } | null
): string {
  if (!emp) return "Anyone"
  return [emp.first_name, emp.last_name].filter(Boolean).join(" ").trim() || "Coworker"
}

export default async function SwapsPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <NotAvailable
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "scheduling", "view"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet."
      />
    )
  }

  const now = new Date()
  const in60 = new Date(now)
  in60.setDate(in60.getDate() + 60)

  const [
    { data: outgoingRaw },
    { data: incomingRaw },
    { data: myUpcomingRaw },
    { data: coworkersRaw },
    { data: facility },
  ] = await Promise.all([
    supabase
      .from("schedule_swap_requests")
      .select(
        "id, status, decision_note, created_at, requester_employee_id, target_employee_id, requester:requester_employee_id(first_name, last_name), target:target_employee_id(first_name, last_name), requester_shift:requester_shift_id(id, starts_at, ends_at, role_label), target_shift:target_shift_id(id, starts_at, ends_at, role_label)"
      )
      .eq("requester_employee_id", employeeRow.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("schedule_swap_requests")
      .select(
        "id, status, decision_note, created_at, requester_employee_id, target_employee_id, requester:requester_employee_id(first_name, last_name), target:target_employee_id(first_name, last_name), requester_shift:requester_shift_id(id, starts_at, ends_at, role_label), target_shift:target_shift_id(id, starts_at, ends_at, role_label)"
      )
      .eq("target_employee_id", employeeRow.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("schedule_shifts")
      .select(
        "id, starts_at, ends_at, role_label, departments(name)"
      )
      .eq("employee_id", employeeRow.id)
      .eq("status", "published")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", in60.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .neq("id", employeeRow.id)
      .order("first_name", { ascending: true }),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
  ])

  const tz = facility?.timezone ?? null
  const outgoing = (outgoingRaw ?? []) as unknown as SwapJoinRow[]
  const incoming = (incomingRaw ?? []) as unknown as SwapJoinRow[]

  type MyShiftRow = {
    id: string
    starts_at: string
    ends_at: string
    role_label: string | null
    departments: { name: string } | null
  }
  const myShifts = ((myUpcomingRaw ?? []) as unknown as MyShiftRow[]).map(
    (s) => ({
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      role_label: s.role_label,
      department_name: s.departments?.name ?? null,
    })
  )
  const coworkers = (coworkersRaw ?? []).map((c) => ({
    id: c.id,
    label:
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Coworker",
  }))

  function ShiftSummary({
    shift,
  }: {
    shift: SwapJoinRow["requester_shift"]
  }) {
    if (!shift) return <span className="text-xs text-muted-foreground">—</span>
    return (
      <span className="text-xs">
        {formatDateRange(shift.starts_at, shift.ends_at, tz)}
        {shift.role_label ? ` · ${shift.role_label}` : ""}
      </span>
    )
  }

  function renderRow(row: SwapJoinRow, side: "outgoing" | "incoming") {
    const otherName =
      side === "outgoing" ? fullName(row.target) : fullName(row.requester)
    const myShift = side === "outgoing" ? row.requester_shift : row.target_shift
    const theirShift =
      side === "outgoing" ? row.target_shift : row.requester_shift
    const isPending = row.status === "pending"
    const canCancel =
      side === "outgoing" &&
      (row.status === "pending" || row.status === "accepted")
    const canAccept = side === "incoming" && isPending
    return (
      <li key={row.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{otherName}</span>
          <Badge variant={statusBadgeVariant(row.status)}>
            {statusLabel(row.status)}
          </Badge>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              {side === "outgoing" ? "My shift" : "Your shift"}
            </span>
            <ShiftSummary shift={myShift} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              {side === "outgoing" ? "Their shift" : "Their shift"}
            </span>
            <ShiftSummary shift={theirShift} />
          </div>
        </div>
        {row.decision_note ? (
          <p className="text-sm text-muted-foreground">{row.decision_note}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Submitted {formatDateTime(row.created_at, tz)}
        </p>
        <div className="flex flex-wrap gap-2">
          {canAccept ? <SwapAcceptButton id={row.id} /> : null}
          {canCancel ? <SwapCancelButton id={row.id} /> : null}
        </div>
      </li>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / Swaps
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Shift swaps
        </h1>
      </div>

      <SwapForm myShifts={myShifts} coworkers={coworkers} timezone={tz} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Outgoing</h2>
        {outgoing.length === 0 ? (
          <Card>
            <CardHeader>
              <CardDescription>No swap requests</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
            {outgoing.map((r) => renderRow(r, "outgoing"))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Incoming</h2>
        {incoming.length === 0 ? (
          <Card>
            <CardHeader>
              <CardDescription>No swap requests</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
            {incoming.map((r) => renderRow(r, "incoming"))}
          </ul>
        )}
      </section>
    </div>
  )
}
