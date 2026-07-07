
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { PageHeader } from "@/components/ui/page-header"
import {
  Card,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { CancelTimeOffButton } from "../_components/cancel-time-off-button"
import { formatDateTime } from "../_components/format-utils"
import { TimeOffForm } from "../_components/time-off-form"
import { NotAvailable } from "../_components/not-available"
import type { TimeOffStatus } from "../types"

export const dynamic = "force-dynamic"


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

const NOT_AVAILABLE_SEGMENTS = [
  { label: "Scheduling", href: "/reports/scheduling" },
  { label: "Time off" },
]

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
        segments={NOT_AVAILABLE_SEGMENTS}
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "scheduling", "view"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet."
        segments={NOT_AVAILABLE_SEGMENTS}
      />
    )
  }

  const [{ data: requestsRaw }, { data: facility }] = await Promise.all([
    supabase
      .from("schedule_time_off_requests")
      .select("id, starts_at, ends_at, reason, status, created_at")
      .eq("employee_id", employeeRow.id)
      .order("created_at", { ascending: false })
      .limit(50),
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
      <PageHeader
        variant="display"
        module="scheduling"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Scheduling", href: "/reports/scheduling" },
              { label: "Time off" },
            ]}
          />
        }
        title="Time off"
        description="Request time off and track your past requests."
      />

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
