"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import {
  formatDateTime,
  formatTimeRange,
  weekStartFor,
  addDays,
  toISODate,
  DAY_SHORT,
} from "../../_lib/datetime"
import type {
  DepartmentLite,
  EmployeeLite,
  ShiftStatus,
  ShiftWithRefs,
  TemplateRow,
} from "../../_lib/types"
import { ApplyTemplateForm } from "./apply-template-form"
import { PublishButton } from "./publish-button"
import { ShiftForm } from "./shift-form"

type Props = {
  facilityId: string
  shifts: ShiftWithRefs[]
  departments: DepartmentLite[]
  employees: EmployeeLite[]
  templates: TemplateRow[]
  selectedShift: ShiftWithRefs | null
  windowStartIso: string
  windowEndIso: string
  anchorIsoDate: string
  filters: {
    dept: string | null
    status: ShiftStatus | null
  }
}

type Panel = "none" | "new" | "edit" | "apply-template"

export function ShiftsClient(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [panel, setPanel] = useState<Panel>(
    props.selectedShift ? "edit" : "none"
  )
  const [view, setView] = useState<"table" | "week">("table")
  const [defaultDate, setDefaultDate] = useState<string | null>(null)

  const buildHref = useCallback(
    (overrides: Record<string, string | null | undefined>): string => {
      const sp = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(overrides)) {
        if (v === null || v === undefined || v === "") sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      return qs ? `${pathname}?${qs}` : pathname
    },
    [pathname, searchParams]
  )

  const closePanel = useCallback(() => {
    setPanel("none")
    if (props.selectedShift) {
      router.replace(buildHref({ shift: null }), { scroll: false })
    }
  }, [props.selectedShift, router, buildHref])

  const onSaved = useCallback(() => {
    setPanel("none")
    router.replace(buildHref({ shift: null }), { scroll: false })
    router.refresh()
  }, [router, buildHref])

  const openNewForDate = useCallback((isoDate: string) => {
    const d = new Date(`${isoDate}T09:00:00`)
    const pad = (n: number) => String(n).padStart(2, "0")
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    setDefaultDate(local)
    setPanel("new")
    router.replace(buildHref({ shift: null }), { scroll: false })
  }, [router, buildHref])

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        departments={props.departments}
        currentDept={props.filters.dept}
        currentStatus={props.filters.status}
        anchorIsoDate={props.anchorIsoDate}
        buildHref={buildHref}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => setView("table")}
            className={cn("rounded px-2.5 py-1 text-xs font-medium transition-colors", view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >Table</button>
          <button
            type="button"
            onClick={() => setView("week")}
            className={cn("rounded px-2.5 py-1 text-xs font-medium transition-colors", view === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >Week grid</button>
        </div>
        <Button
          onClick={() => {
            setPanel((p) => (p === "new" ? "none" : "new"))
            router.replace(buildHref({ shift: null }), { scroll: false })
          }}
        >
          {panel === "new" ? "Close form" : "New shift"}
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            setPanel((p) => (p === "apply-template" ? "none" : "apply-template"))
          }
        >
          {panel === "apply-template" ? "Close" : "Apply template"}
        </Button>
        <PublishButton
          startsAtIso={props.windowStartIso}
          endsAtIso={props.windowEndIso}
        />
      </div>

      {panel === "new" && (
        <ShiftForm
          departments={props.departments}
          employees={props.employees}
          editing={null}
          defaultStartsAt={defaultDate}
          onClose={closePanel}
          onSaved={onSaved}
        />
      )}

      {panel === "apply-template" && (
        <ApplyTemplateForm
          templates={props.templates}
          onClose={() => setPanel("none")}
        />
      )}

      {view === "table" ? (
        props.shifts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/60 sticky top-0 z-10">
                <tr className="text-left">
                  <th className="border-b px-3 py-2 font-medium">Day</th>
                  <th className="border-b px-3 py-2 font-medium">Time</th>
                  <th className="border-b px-3 py-2 font-medium">Department</th>
                  <th className="border-b px-3 py-2 font-medium">Employee</th>
                  <th className="border-b px-3 py-2 font-medium">Role</th>
                  <th className="border-b px-3 py-2 font-medium">Status</th>
                  <th className="border-b px-3 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {props.shifts.map((shift) => {
                  const isSelected = props.selectedShift?.id === shift.id
                  return (
                    <tr
                      key={shift.id}
                      className={cn(
                        "hover:bg-accent/40 cursor-pointer transition-colors",
                        isSelected && "bg-accent/60"
                      )}
                    >
                      <td className="border-b px-3 py-2">
                        <Link
                          href={buildHref({ shift: shift.id })}
                          onClick={() => setPanel("edit")}
                          className="block"
                          scroll={false}
                        >
                          {formatDateTime(shift.starts_at)}
                        </Link>
                      </td>
                      <td className="border-b px-3 py-2 tabular-nums">
                        {formatTimeRange(shift.starts_at, shift.ends_at)}
                      </td>
                      <td className="border-b px-3 py-2">
                        {shift.department ? (
                          <span className="inline-flex items-center gap-1.5">
                            {shift.department.color && (
                              <span
                                aria-hidden
                                className="inline-block size-2 rounded-full"
                                style={{
                                  backgroundColor: shift.department.color,
                                }}
                              />
                            )}
                            {shift.department.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="border-b px-3 py-2">
                        {shift.employee ? (
                          <span>
                            {shift.employee.first_name}{" "}
                            {shift.employee.last_name}
                            {shift.employee.is_minor && (
                              <span className="text-muted-foreground ml-1 text-xs">
                                (minor)
                              </span>
                            )}
                          </span>
                        ) : (
                          <Badge variant="info">Open shift</Badge>
                        )}
                      </td>
                      <td className="border-b px-3 py-2 text-muted-foreground">
                        {shift.role_label ?? "—"}
                      </td>
                      <td className="border-b px-3 py-2">
                        <StatusBadge status={shift.status} />
                      </td>
                      <td className="border-b px-3 py-2">
                        <ComplianceFlags
                          warnings={
                            Array.isArray(shift.compliance_warnings)
                              ? (shift.compliance_warnings as unknown[]).filter(
                                  (x): x is string => typeof x === "string"
                                )
                              : []
                          }
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <WeekGridView
          shifts={props.shifts}
          anchorIsoDate={props.anchorIsoDate}
          onShiftClick={(shiftId) => {
            router.replace(buildHref({ shift: shiftId }), { scroll: false })
            setPanel("edit")
          }}
          onDayClick={openNewForDate}
          selectedShiftId={props.selectedShift?.id ?? null}
        />
      )}

      {props.selectedShift && panel === "edit" && (
        <ShiftForm
          departments={departmentsForEditing(
            props.departments,
            props.selectedShift,
          )}
          employees={props.employees}
          editing={props.selectedShift}
          onClose={closePanel}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

function WeekGridView({
  shifts,
  anchorIsoDate,
  onShiftClick,
  onDayClick,
  selectedShiftId,
}: {
  shifts: ShiftWithRefs[]
  anchorIsoDate: string
  onShiftClick: (id: string) => void
  onDayClick: (isoDate: string) => void
  selectedShiftId: string | null
}) {
  const anchor = new Date(`${anchorIsoDate}T12:00:00Z`)
  const weekStart = weekStartFor(anchor, 1) // 1 = Monday

  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(addDays(weekStart, i))
  }

  function isoDay(d: Date): string {
    return toISODate(d)
  }

  const shiftsByDay = new Map<string, ShiftWithRefs[]>()
  for (const d of days) shiftsByDay.set(isoDay(d), [])
  for (const s of shifts) {
    const dayKey = toISODate(new Date(s.starts_at))
    if (shiftsByDay.has(dayKey)) {
      shiftsByDay.get(dayKey)!.push(s)
    }
  }

  const today = toISODate(new Date())

  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="grid min-w-[700px]" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
        {/* Header row */}
        {days.map((d) => {
          const key = isoDay(d)
          const isToday = key === today
          return (
            <div
              key={key}
              className={cn(
                "border-b border-r last:border-r-0 px-2 py-1.5 text-center",
                isToday ? "bg-primary/5" : "bg-muted/40"
              )}
            >
              <div className={cn("text-xs font-semibold", isToday ? "text-primary" : "text-muted-foreground")}>
                {DAY_SHORT[d.getUTCDay()]}
              </div>
              <div className={cn("text-sm font-medium tabular-nums", isToday && "text-primary")}>
                {d.getUTCDate()}
              </div>
            </div>
          )
        })}

        {/* Shift cards row */}
        {days.map((d) => {
          const key = isoDay(d)
          const dayShifts = shiftsByDay.get(key) ?? []
          const isToday = key === today
          // Day context for AT consumers — the visible cell text would
          // otherwise leave them with no way to tell which day a shift
          // button belongs to.
          const dayLabel = `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`
          return (
            <div
              key={key}
              className={cn(
                "border-r last:border-r-0 min-h-[120px] p-1.5 flex flex-col gap-1",
                isToday && "bg-primary/5"
              )}
            >
              {dayShifts.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onShiftClick(s.id)}
                  aria-label={`${
                    s.employee
                      ? `${s.employee.first_name} ${s.employee.last_name}`
                      : "Open"
                  } shift ${formatTimeRange(s.starts_at, s.ends_at)} on ${dayLabel}${
                    s.department ? `, ${s.department.name}` : ""
                  }${s.status === "cancelled" ? " (cancelled)" : ""}. Click to edit.`}
                  className={cn(
                    "w-full rounded px-1.5 py-1 text-left text-xs transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedShiftId === s.id ? "ring-2 ring-primary" : "",
                    s.status === "published"
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                      : s.status === "cancelled"
                        ? "bg-muted text-muted-foreground line-through"
                        : "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
                  )}
                  style={
                    s.department?.color
                      ? { borderLeft: `3px solid ${s.department.color}` }
                      : undefined
                  }
                >
                  <div className="font-medium truncate">
                    {formatTimeRange(s.starts_at, s.ends_at)}
                  </div>
                  <div className="truncate opacity-80">
                    {s.employee
                      ? `${s.employee.first_name} ${s.employee.last_name}`
                      : "Open"}
                  </div>
                  {s.department && (
                    <div className="truncate opacity-70">{s.department.name}</div>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onDayClick(key)}
                aria-label={`Add a shift on ${dayLabel}`}
                className="mt-auto w-full rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                + Add
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FilterBar({
  departments,
  currentDept,
  currentStatus,
  anchorIsoDate,
  buildHref,
}: {
  departments: DepartmentLite[]
  currentDept: string | null
  currentStatus: ShiftStatus | null
  anchorIsoDate: string
  buildHref: (overrides: Record<string, string | null | undefined>) => string
}) {
  const router = useRouter()

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-dept"
          className="text-muted-foreground text-xs font-medium"
        >
          Department
        </label>
        <Select
          value={currentDept || undefined}
          onValueChange={(v) => {
            router.replace(buildHref({ dept: v || null }), { scroll: false })
          }}
        >
          <SelectTrigger id="filter-dept" className="min-w-44">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-status"
          className="text-muted-foreground text-xs font-medium"
        >
          Status
        </label>
        <Select
          value={currentStatus || undefined}
          onValueChange={(v) => {
            router.replace(buildHref({ status: v || null }), { scroll: false })
          }}
        >
          <SelectTrigger id="filter-status" className="min-w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-date"
          className="text-muted-foreground text-xs font-medium"
        >
          Anchor date (±14 days)
        </label>
        <input
          id="filter-date"
          type="date"
          value={anchorIsoDate}
          onChange={(e) => {
            const v = e.target.value || null
            router.replace(buildHref({ date: v }), { scroll: false })
          }}
          className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
        />
      </div>
    </div>
  )
}

// When editing a shift whose department has since been deactivated, that
// department is absent from the active-only list. Add it back (just for this
// form) so the select still shows the current value rather than going blank.
function departmentsForEditing(
  active: DepartmentLite[],
  shift: ShiftWithRefs,
): DepartmentLite[] {
  const current = shift.department
  if (!current || active.some((d) => d.id === current.id)) return active
  return [...active, current]
}

function EmptyState() {
  return (
    <div className="bg-card rounded-md border p-8 text-center">
      <h3 className="text-lg font-medium">No shifts in window</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Adjust the anchor date or create a shift to get started.
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "published"
      ? "success"
      : status === "cancelled"
        ? "secondary"
        : "warning"
  return <Badge variant={variant}>{status}</Badge>
}

function ComplianceFlags({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {warnings.map((w) => (
        <Badge key={w} variant="error">
          {w.replace(/_/g, " ")}
        </Badge>
      ))}
    </div>
  )
}
