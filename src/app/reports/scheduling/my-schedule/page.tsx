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

import { formatDateRange } from "../_components/format-utils"
import type { ShiftStatus } from "../types"

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
          / My schedule
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

function statusBadgeClasses(status: string): string {
  switch (status) {
    case "published":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
    case "cancelled":
      return "bg-muted text-muted-foreground"
    default:
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
  }
}

function statusLabel(status: string): string {
  const map: Record<ShiftStatus, string> = {
    draft: "Draft",
    published: "Published",
    cancelled: "Cancelled",
  }
  return map[status as ShiftStatus] ?? status
}

function parseDateInput(raw: string | undefined): Date | null {
  if (!raw) return null
  // Accept YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type SearchParams = Promise<{
  from?: string
  to?: string
  status?: string
}>

export default async function MySchedulePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireUser()
  const supabase = await createClient()
  const params = await searchParams

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

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const defaultTo = new Date(today)
  defaultTo.setDate(defaultTo.getDate() + 30)

  const fromDate = parseDateInput(params.from) ?? today
  const toDate = parseDateInput(params.to) ?? defaultTo
  const statusFilter =
    params.status === "all" ? "all" : "published"

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", employeeRow.facility_id)
    .maybeSingle()
  const tz = facility?.timezone ?? null

  let query = supabase
    .from("schedule_shifts")
    .select(
      "id, starts_at, ends_at, role_label, status, department_id, departments(name)"
    )
    .eq("employee_id", employeeRow.id)
    .gte("starts_at", fromDate.toISOString())
    .lte("starts_at", toDate.toISOString())
    .order("starts_at", { ascending: true })

  if (statusFilter !== "all") {
    query = query.eq("status", "published")
  }

  const { data: shiftsRaw } = await query

  type ShiftRow = {
    id: string
    starts_at: string
    ends_at: string
    role_label: string | null
    status: string
    department_id: string
    departments: { name: string } | null
  }
  const shifts = (shiftsRaw ?? []) as unknown as ShiftRow[]

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / My schedule
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          My schedule
        </h1>
      </div>

      <form
        method="get"
        className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end"
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="from" className="text-xs font-medium">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={toDateInput(fromDate)}
            className="border-input bg-background h-11 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="to" className="text-xs font-medium">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={toDateInput(toDate)}
            className="border-input bg-background h-11 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="status" className="text-xs font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusFilter}
            className="border-input bg-background h-11 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="published">Published</option>
            <option value="all">All</option>
          </select>
        </div>
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-11 rounded-md px-4 text-sm font-medium shadow-xs hover:bg-primary/90"
        >
          Apply
        </button>
      </form>

      {shifts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>No upcoming shifts</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
          {shifts.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-2 px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {formatDateRange(s.starts_at, s.ends_at, tz)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClasses(
                    s.status
                  )}`}
                >
                  {statusLabel(s.status)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{s.departments?.name ?? "—"}</span>
                {s.role_label ? <span>· {s.role_label}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
