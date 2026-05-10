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

import { CancelTimeOffButton } from "../_components/cancel-time-off-button"
import { formatDateTime } from "../_components/format-utils"
import { TimeOffForm } from "../_components/time-off-form"
import type { TimeOffStatus } from "../types"

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
          / Time off
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
    case "approved":
      return "success"
    case "denied":
      return "error"
    case "cancelled":
      return "outline"
    default:
      return "warning"
  }
}

function statusLabel(status: string): string {
  const map: Record<TimeOffStatus, string> = {
    pending: "Pending",
    approved: "Approved",
    denied: "Denied",
    cancelled: "Cancelled",
  }
  return map[status as TimeOffStatus] ?? status
}

export default async function TimeOffPage() {
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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_view")
    .eq("module_key", "scheduling")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_view) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet."
      />
    )
  }

  const [{ data: requestsRaw }, { data: facility }] = await Promise.all([
    supabase
      .from("schedule_time_off_requests")
      .select("id, starts_at, ends_at, reason, status, created_at")
      .eq("employee_id", employeeRow.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
  ])

  const tz = facility?.timezone ?? null
  const requests = requestsRaw ?? []

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / Time off
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Time off</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Request time off and track your past requests.
        </p>
      </div>

      <TimeOffForm />

      {requests.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>No requests yet</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {formatDateTime(r.starts_at, tz)} →{" "}
                  {formatDateTime(r.ends_at, tz)}
                </span>
                <Badge variant={statusBadgeVariant(r.status)}>
                  {statusLabel(r.status)}
                </Badge>
              </div>
              {r.reason ? (
                <p className="text-sm text-muted-foreground">{r.reason}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Submitted {formatDateTime(r.created_at, tz)}
              </p>
              {r.status === "pending" || r.status === "approved" ? (
                <CancelTimeOffButton id={r.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
