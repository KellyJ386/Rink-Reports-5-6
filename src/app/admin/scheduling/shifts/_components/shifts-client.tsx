"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import {
  formatDateTime,
  formatTimeRange,
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

      {props.shifts.length === 0 ? (
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
                            <Badge tone="info">Open shift</Badge>
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
      )}

      {props.selectedShift && panel === "edit" && (
        <ShiftForm
          departments={props.departments}
          employees={props.employees}
          editing={props.selectedShift}
          onClose={closePanel}
          onSaved={onSaved}
        />
      )}
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
        <select
          id="filter-dept"
          value={currentDept ?? ""}
          onChange={(e) => {
            const v = e.target.value || null
            router.replace(buildHref({ dept: v }), { scroll: false })
          }}
          className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="filter-status"
          className="text-muted-foreground text-xs font-medium"
        >
          Status
        </label>
        <select
          id="filter-status"
          value={currentStatus ?? ""}
          onChange={(e) => {
            const v = e.target.value || null
            router.replace(buildHref({ status: v }), { scroll: false })
          }}
          className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="cancelled">Cancelled</option>
        </select>
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
  const tone =
    status === "published"
      ? "ok"
      : status === "cancelled"
        ? "muted"
        : "warn"
  return <Badge tone={tone}>{status}</Badge>
}

function ComplianceFlags({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {warnings.map((w) => (
        <Badge key={w} tone="danger">
          {w.replace(/_/g, " ")}
        </Badge>
      ))}
    </div>
  )
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: "ok" | "warn" | "danger" | "muted" | "info"
}) {
  const palette: Record<string, string> = {
    ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
    warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
    danger: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
    muted: "bg-muted text-muted-foreground",
    info: "bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        palette[tone]
      )}
    >
      {children}
    </span>
  )
}
