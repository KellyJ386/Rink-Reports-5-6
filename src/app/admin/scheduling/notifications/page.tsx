import Link from "next/link"
import type { ComponentProps } from "react"
import { ChevronDown } from "lucide-react"

import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { cn } from "@/lib/utils"

import { formatDateTime } from "../_lib/datetime"
import { SendRemindersForm } from "./_components/send-reminders-form"

export const dynamic = "force-dynamic"

const NOTIFICATION_TYPES = [
  "schedule_published",
  "shift_changed",
  "open_shift_available",
  "swap_request_received",
  "swap_approved",
  "swap_denied",
  "time_off_decided",
  "overtime_warning",
  "shift_reminder",
] as const

type SearchParams = Promise<{
  type?: string
  recipient?: string
  unread?: string
  from?: string
  to?: string
}>

type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
  employee_code: string | null
}

type NotificationRow = {
  id: string
  facility_id: string
  employee_id: string
  notification_type: string
  shift_id: string | null
  swap_id: string | null
  time_off_id: string | null
  created_at: string
  read_at: string | null
}

const TYPE_BADGE: Record<string, BadgeProps["variant"]> = {
  schedule_published: "info",
  shift_changed: "special",
  open_shift_available: "info",
  swap_request_received: "warning",
  swap_approved: "success",
  swap_denied: "error",
  time_off_decided: "special",
  overtime_warning: "warning",
}

const NATIVE_SELECT_CLASS =
  "border border-input bg-input-bg flex h-10 w-full min-w-0 appearance-none rounded-md px-3 py-1 pr-9 text-base shadow-[var(--shadow-elev-1)] outline-none transition-colors duration-150"

export const metadata = { title: "Scheduling Notifications | MFO / Rink Reports" }

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null
  const sp = await searchParams

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before reviewing notifications.
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

  const [{ data: empsRaw }, { data: facilityRow }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true })
      .limit(500),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle<{ timezone: string | null }>(),
  ])
  const emps = (empsRaw ?? []) as EmployeeLite[]
  const empMap = new Map(emps.map((e) => [e.id, e]))
  // Server-rendered timestamps: pin to the facility zone, not the server's.
  const tz = facilityRow?.timezone ?? null

  let query = supabase
    .from("schedule_notifications")
    .select(
      "id, facility_id, employee_id, notification_type, shift_id, swap_id, time_off_id, created_at, read_at"
    )
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(300)

  const typeFilter = sp.type && sp.type !== "all" ? sp.type : null
  if (typeFilter) query = query.eq("notification_type", typeFilter)
  const recipientFilter = sp.recipient ?? ""
  if (recipientFilter) query = query.eq("employee_id", recipientFilter)
  if (sp.unread === "yes") query = query.is("read_at", null)
  if (sp.unread === "no") query = query.not("read_at", "is", null)
  if (sp.from) {
    const d = new Date(sp.from)
    if (!Number.isNaN(d.getTime())) {
      query = query.gte("created_at", d.toISOString())
    }
  }
  if (sp.to) {
    const d = new Date(sp.to)
    if (!Number.isNaN(d.getTime())) {
      query = query.lt("created_at", d.toISOString())
    }
  }

  const { data: rowsRaw } = await query
  const rows = (rowsRaw ?? []) as NotificationRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      <SendRemindersForm />

      <form
        method="GET"
        className="bg-card grid gap-3 rounded-md border p-4 shadow-sm md:grid-cols-5"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-type" className="text-xs font-medium">
            Type
          </label>
          <Label htmlFor="filter-type" className="text-sm">
            Type
          </Label>
          <NativeSelect
            id="filter-type"
            name="type"
            defaultValue={sp.type ?? "all"}
          >
            <option value="all">All</option>
            {NOTIFICATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-recipient" className="text-xs font-medium">
            Recipient
          </label>
          <Label htmlFor="filter-recipient" className="text-sm">
            Recipient
          </Label>
          <NativeSelect
            id="filter-recipient"
            name="recipient"
            defaultValue={recipientFilter}
          >
            <option value="">All employees</option>
            {emps.map((e) => (
              <option key={e.id} value={e.id}>
                {e.last_name}, {e.first_name}
                {e.employee_code ? ` (${e.employee_code})` : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-unread" className="text-xs font-medium">
            Unread
          </label>
          <Label htmlFor="filter-unread" className="text-sm">
            Unread
          </Label>
          <NativeSelect
            id="filter-unread"
            name="unread"
            defaultValue={sp.unread ?? ""}
          >
            <option value="">Any</option>
            <option value="yes">Unread</option>
            <option value="no">Read</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-from" className="text-xs font-medium">
            From
          </label>
          <Label htmlFor="filter-from" className="text-sm">
            From
          </Label>
          <Input
            id="filter-from"
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-to" className="text-xs font-medium">
            To
          </label>
          <Label htmlFor="filter-to" className="text-sm">
            To
          </Label>
          <Input id="filter-to" type="date" name="to" defaultValue={sp.to ?? ""} />
        </div>
        <div className="md:col-span-5 flex justify-end gap-2">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          <Button type="button" size="sm" variant="ghost" asChild>
            <Link href="/admin/scheduling/notifications">Reset</Link>
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
          No notifications match these filters.
        </div>
      ) : (
        <div className="bg-card overflow-x-auto rounded-md border shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Recipient</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Related</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const emp = empMap.get(n.employee_id)
                const related =
                  n.shift_id ?? n.swap_id ?? n.time_off_id ?? null
                const relatedLabel = n.shift_id
                  ? `shift:${shorten(n.shift_id)}`
                  : n.swap_id
                    ? `swap:${shorten(n.swap_id)}`
                    : n.time_off_id
                      ? `time-off:${shorten(n.time_off_id)}`
                      : "—"
                const typeVariant =
                  TYPE_BADGE[n.notification_type] ?? "neutral"
                return (
                  <tr key={n.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDateTime(n.created_at, tz)}
                    </td>
                    <td className="px-3 py-2">
                      {emp
                        ? `${emp.last_name}, ${emp.first_name}${
                            emp.employee_code ? ` (${emp.employee_code})` : ""
                          }`
                        : n.employee_id}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={typeVariant}>
                        {n.notification_type.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {related ? relatedLabel : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {n.read_at ? (
                        <span className="text-muted-foreground text-xs">
                          Read {formatDateTime(n.read_at, tz)}
                        </span>
                      ) : (
                        <Badge variant="warning">Unread</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function shorten(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

function NativeSelect({
  children,
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(NATIVE_SELECT_CLASS, className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Notifications"
      description="Read-only feed of scheduling notifications for this facility."
    />
  )
}
