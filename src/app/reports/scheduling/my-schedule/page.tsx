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

import { WeekCalendar } from "../_components/week-calendar"
import { formatDateRange } from "../_components/format-utils"
import type { ShiftStatus } from "../types"

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
  view?: string
  weekOf?: string
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

  const currentView = params.view === "week" ? "week" : "list"

  // For week view, compute the Sunday of the current week
  function getWeekStart(anchor: Date): Date {
    const d = new Date(anchor)
    d.setDate(d.getDate() - d.getDay()) // back to Sunday
    d.setHours(0, 0, 0, 0)
    return d
  }

  function toLocalDate(iso: string): Date {
    const [y, m, day] = iso.split("-").map(Number)
    return new Date(y, m - 1, day)
  }

  const weekStart = params.weekOf
    ? getWeekStart(toLocalDate(params.weekOf))
    : getWeekStart(new Date())

  const weekStartIso = (() => {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`
  })()

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
    .order("starts_at", { ascending: true })

  if (currentView === "week") {
    // Week view date range
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    query = query
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString())
  } else {
    query = query
      .gte("starts_at", fromDate.toISOString())
      .lte("starts_at", toDate.toISOString())
    if (statusFilter !== "all") {
      query = query.eq("status", "published")
    }
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

  const DISPLAY_FONT =
    "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
  const NAVY = "#003B6F"
  const GREEN = "#4DFF00"
  const GREEN_INK = "#1F6B00"
  const SURFACE = "var(--card)"
  const ELEVATED = "var(--secondary)"
  const BORDER = "var(--border)"
  const SECONDARY = "var(--muted-foreground)"
  const FOREGROUND = "var(--foreground)"

  const statusColors: Record<string, string> = {
    published: "#1F6B00",
    cancelled: "#9DB2C8",
    draft: "#0EA5E9",
  }

  return (
    <div
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: "24px 16px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {/* Header */}
      <div>
        <p style={{ fontSize: 12, color: SECONDARY, marginBottom: 12 }}>
          <Link
            href="/reports/scheduling"
            style={{ color: SECONDARY, textDecoration: "none" }}
          >
            Scheduling
          </Link>
          {" / My schedule"}
        </p>
        <h1
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "clamp(30px, 6vw, 44px)",
            lineHeight: 1,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            color: FOREGROUND,
            margin: 0,
          }}
        >
          My Schedule
        </h1>
      </div>

      {/* View toggle */}
      <div
        style={{
          display: "flex",
          gap: 3,
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 9,
          padding: 3,
          width: "fit-content",
        }}
      >
        {(["list", "week"] as const).map((v) => (
          <Link
            key={v}
            href={`/reports/scheduling/my-schedule?view=${v}`}
            style={{
              padding: "7px 16px",
              fontSize: 12.5,
              fontWeight: 700,
              borderRadius: 6,
              background: currentView === v ? GREEN : "transparent",
              color: currentView === v ? GREEN_INK : SECONDARY,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: ".04em",
              textDecoration: "none",
            }}
          >
            {v}
          </Link>
        ))}
      </div>

      {currentView === "week" ? (
        <WeekCalendar
          shifts={shifts}
          weekStartIso={weekStartIso}
          timezone={tz}
        />
      ) : (
        <>
          {/* Date filter */}
          <form
            method="get"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              padding: "14px 16px",
              alignItems: "flex-end",
            }}
          >
            {[
              { id: "from", label: "From", defaultValue: toDateInput(fromDate), type: "date" },
              { id: "to", label: "To", defaultValue: toDateInput(toDate), type: "date" },
            ].map((f) => (
              <div
                key={f.id}
                style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 130px" }}
              >
                <label
                  htmlFor={f.id}
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: ".12em",
                    color: SECONDARY,
                    textTransform: "uppercase",
                  }}
                >
                  {f.label}
                </label>
                <input
                  id={f.id}
                  name={f.id}
                  type={f.type}
                  defaultValue={f.defaultValue}
                  style={{
                    height: 40,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    padding: "0 12px",
                    fontSize: 13,
                    color: FOREGROUND,
                    outline: "none",
                    background: SURFACE,
                  }}
                />
              </div>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 130px" }}>
              <label
                htmlFor="status"
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: ".12em",
                  color: SECONDARY,
                  textTransform: "uppercase",
                }}
              >
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={statusFilter}
                style={{
                  height: 40,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "0 12px",
                  fontSize: 13,
                  color: FOREGROUND,
                  outline: "none",
                  background: SURFACE,
                }}
              >
                <option value="published">Published</option>
                <option value="all">All</option>
              </select>
            </div>
            <button
              type="submit"
              style={{
                height: 40,
                padding: "0 20px",
                borderRadius: 8,
                border: 0,
                background: NAVY,
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Apply
            </button>
          </form>

          {shifts.length === 0 ? (
            <div
              style={{
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                padding: "24px 16px",
                textAlign: "center",
                color: SECONDARY,
                fontSize: 13,
              }}
            >
              No shifts in this range
            </div>
          ) : (
            <div
              style={{
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                overflow: "hidden",
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              {shifts.map((s, i) => {
                const color = statusColors[s.status] ?? "#9DB2C8"
                return (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderBottom:
                        i < shifts.length - 1 ? `1px solid ${BORDER}` : "none",
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: FOREGROUND }}>
                        {formatDateRange(s.starts_at, s.ends_at, tz)}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          marginTop: 3,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: 11.5, color: SECONDARY }}>
                          {s.departments?.name ?? "—"}
                        </span>
                        {s.role_label ? (
                          <span style={{ fontSize: 11.5, color: SECONDARY }}>
                            · {s.role_label}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 9999,
                        background: `${color}18`,
                        color,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        flexShrink: 0,
                      }}
                    >
                      {statusLabel(s.status)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
