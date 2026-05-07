import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { formatRelativeAge } from "../_components/format-utils"
import {
  MarkAllReadButton,
  MarkReadButton,
} from "../_components/notification-buttons"

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
          / Notifications
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

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  shift_published: "Shift published",
  shift_assigned: "Shift assigned",
  shift_cancelled: "Shift cancelled",
  shift_unassigned: "Shift unassigned",
  swap_requested: "Swap requested",
  swap_accepted: "Swap accepted",
  swap_denied: "Swap denied",
  swap_applied: "Swap applied",
  swap_cancelled: "Swap cancelled",
  time_off_requested: "Time-off requested",
  time_off_approved: "Time-off approved",
  time_off_denied: "Time-off denied",
  time_off_cancelled: "Time-off cancelled",
  open_shift_posted: "Open shift posted",
  open_shift_claimed: "Open shift claimed",
  open_shift_approved: "Open shift approved",
}

function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

function bodyFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const obj = payload as Record<string, unknown>
  const message =
    typeof obj.message === "string"
      ? obj.message
      : typeof obj.body === "string"
        ? obj.body
        : null
  return message
}

type NotifRow = {
  id: string
  notification_type: string
  payload: unknown
  read_at: string | null
  created_at: string
  shift_id: string | null
  swap_id: string | null
  time_off_id: string | null
}

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
        showSignOut
      />
    )
  }

  const { data: rowsRaw } = await supabase
    .from("schedule_notifications")
    .select(
      "id, notification_type, payload, read_at, created_at, shift_id, swap_id, time_off_id"
    )
    .eq("employee_id", employeeRow.id)
    .order("created_at", { ascending: false })
    .limit(100)

  const rows = (rowsRaw ?? []) as NotifRow[]
  const unread = rows.filter((r) => r.read_at === null)
  const read = rows.filter((r) => r.read_at !== null)

  function NotifRowItem({ row }: { row: NotifRow }) {
    const body = bodyFromPayload(row.payload)
    return (
      <li className="flex flex-col gap-2 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            {notificationTypeLabel(row.notification_type)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeAge(row.created_at)}
          </span>
        </div>
        {body ? <p className="text-sm">{body}</p> : null}
        {row.read_at === null ? <MarkReadButton id={row.id} /> : null}
      </li>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/reports/scheduling" className="hover:underline">
              Scheduling
            </Link>{" "}
            / Notifications
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Notifications
          </h1>
        </div>
        <MarkAllReadButton disabled={unread.length === 0} />
      </div>

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
                <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                  {unread.length}
                </span>
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
