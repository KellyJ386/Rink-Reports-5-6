
import { Badge } from "@/components/ui/badge"
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

import { formatRelativeAge } from "../_components/format-utils"
import {
  AcknowledgeButton,
  MarkAllReadButton,
  MarkReadButton,
} from "../_components/notification-buttons"
import { NotAvailable } from "../_components/not-available"

export const dynamic = "force-dynamic"


// The 9 types the DB CHECK constraint allows (migration 20) — anything else
// falls through to the underscore-replace fallback.
const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  schedule_published: "Schedule published",
  shift_changed: "Shift changed",
  open_shift_available: "Open shift available",
  swap_request_received: "Swap request received",
  swap_approved: "Swap approved",
  swap_denied: "Swap denied",
  time_off_decided: "Time off decided",
  overtime_warning: "Overtime warning",
  shift_reminder: "Shift reminder",
}

function notificationTypeLabel(row: NotifRow): string {
  // Surface the actual outcome for time-off decisions instead of the
  // ambiguous "decided".
  if (row.notification_type === "time_off_decided") {
    const decision = payloadString(row.payload, "decision")
    if (decision === "approved") return "Time off approved"
    if (decision === "denied") return "Time off denied"
    if (decision === "cancelled") return "Time off cancelled"
  }
  return (
    NOTIFICATION_TYPE_LABELS[row.notification_type] ??
    row.notification_type.replace(/_/g, " ")
  )
}

function payloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null
  const v = (payload as Record<string, unknown>)[key]
  return typeof v === "string" && v.length > 0 ? v : null
}

function bodyFromPayload(row: NotifRow): string | null {
  const message =
    payloadString(row.payload, "message") ?? payloadString(row.payload, "body")
  if (message) return message
  if (row.notification_type === "time_off_decided") {
    const decision = payloadString(row.payload, "decision")
    const note = payloadString(row.payload, "decision_note")
    const base =
      decision === "approved"
        ? "Your time-off request was approved."
        : decision === "denied"
          ? "Your time-off request was denied."
          : decision === "cancelled"
            ? "Your time-off request was cancelled by a manager."
            : null
    if (base) return note ? `${base} Note: ${note}` : base
    return note ? `Note: ${note}` : null
  }
  if (row.notification_type === "swap_denied") {
    const note = payloadString(row.payload, "decision_note")
    return note ? `Note: ${note}` : null
  }
  if (row.notification_type === "swap_approved") {
    const role = payloadString(row.payload, "role")
    return role === "target"
      ? "A swap was approved — you picked up the shift."
      : "Your swap request was approved."
  }
  return null
}

type NotifRow = {
  id: string
  notification_type: string
  payload: unknown
  read_at: string | null
  acknowledged_at: string | null
  created_at: string
  shift_id: string | null
  swap_id: string | null
  time_off_id: string | null
}

const NOT_AVAILABLE_SEGMENTS = [
  { label: "Scheduling", href: "/reports/scheduling" },
  { label: "Notifications" },
]

export default async function NotificationsPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id")
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

  const { data: rowsRaw } = await supabase
    .from("schedule_notifications")
    .select(
      "id, notification_type, payload, read_at, acknowledged_at, created_at, shift_id, swap_id, time_off_id"
    )
    .eq("employee_id", employeeRow.id)
    .order("created_at", { ascending: false })
    .limit(100)

  const rows = (rowsRaw ?? []) as NotifRow[]
  const unread = rows.filter((r) => r.read_at === null)
  const read = rows.filter((r) => r.read_at !== null)

  function NotifRowItem({ row }: { row: NotifRow }) {
    const body = bodyFromPayload(row)
    const needsAck =
      row.notification_type === "schedule_published" &&
      row.acknowledged_at === null
    return (
      <li className="flex flex-col gap-2 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{notificationTypeLabel(row)}</Badge>
            {row.notification_type === "schedule_published" &&
            row.acknowledged_at !== null ? (
              <Badge variant="success">Acknowledged</Badge>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            {formatRelativeAge(row.created_at)}
          </span>
        </div>
        {body ? <p className="text-sm">{body}</p> : null}
        <div className="flex flex-wrap gap-2">
          {needsAck ? <AcknowledgeButton id={row.id} /> : null}
          {row.read_at === null && !needsAck ? (
            <MarkReadButton id={row.id} />
          ) : null}
        </div>
      </li>
    )
  }

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
              { label: "Notifications" },
            ]}
          />
        }
        title="Notifications"
        actions={<MarkAllReadButton disabled={unread.length === 0} />}
      />

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>No notifications</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Unread
              {unread.length > 0 ? (
                <Badge className="ml-2">{unread.length}</Badge>
              ) : null}
            </h2>
            {unread.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardDescription>All caught up.</CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
                {unread.map((row) => (
                  <NotifRowItem key={row.id} row={row} />
                ))}
              </ul>
            )}
          </section>

          {read.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold tracking-tight">Read</h2>
              <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
                {read.map((row) => (
                  <NotifRowItem key={row.id} row={row} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
