"use client"

import {
  CalendarDays,
  Copy,
  DollarSign,
  Pencil,
  Repeat2,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import type { EmployeeLite, JobAreaLite } from "../../_lib/types"
import { roundHours } from "../../_lib/weekly-hours"
import { fmtHour } from "../_lib/grid-geometry"
import {
  personColor,
  shiftColor,
  type ColorBy,
  type Density,
  type GridEvent,
} from "../_lib/board-model"
import { NONE_VALUE, OPEN_VALUE } from "./assign-popover"

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function Kpi({
  label,
  value,
  sub,
  icon,
  tone = "navy",
}: {
  label: string
  value: string | number
  sub: string
  icon: React.ReactNode
  tone?: "navy" | "green" | "amber" | "red"
}) {
  const valueColor =
    tone === "green"
      ? "text-success-soft-foreground"
      : tone === "amber"
        ? "text-warning-soft-foreground"
        : tone === "red"
          ? "text-destructive-soft-foreground"
          : "text-foreground"
  return (
    <Card className="relative gap-1 overflow-hidden px-4 py-4">
      <div className="absolute right-3 top-3 text-muted-foreground/70" aria-hidden>
        {icon}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div
        className={cn(
          "font-display text-[32px] leading-none tracking-tight",
          valueColor,
        )}
      >
        {value}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </Card>
  )
}

export function KpiStrip({
  scheduledHours,
  shiftCount,
  employeeCount,
  openShiftCount,
  swapCount,
  hourlyRate,
}: {
  scheduledHours: number
  shiftCount: number
  employeeCount: number
  openShiftCount: number
  swapCount: number
  hourlyRate: number
}) {
  const cost = Math.round(scheduledHours * hourlyRate).toLocaleString()
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi
        label="Scheduled hrs"
        value={roundHours(scheduledHours)}
        sub="This week"
        icon={<CalendarDays className="h-[18px] w-[18px]" />}
      />
      <Kpi
        label="Shifts"
        value={shiftCount}
        sub={`${employeeCount} employees`}
        icon={<Users className="h-[18px] w-[18px]" />}
      />
      <Kpi
        label="Labor cost"
        value={`$${cost}`}
        sub={`Est · $${hourlyRate}/hr`}
        icon={<DollarSign className="h-[18px] w-[18px]" />}
        tone="green"
      />
      <Kpi
        label="Open shifts"
        value={openShiftCount}
        sub="Need coverage"
        icon={<TriangleAlert className="h-[18px] w-[18px]" />}
        tone="amber"
      />
      <Kpi
        label="Swap requests"
        value={swapCount}
        sub="Awaiting approval"
        icon={<Repeat2 className="h-[18px] w-[18px]" />}
        tone={swapCount > 0 ? "red" : "navy"}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar controls
// ---------------------------------------------------------------------------

function SegGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
            value === o.value
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorBySwitcher({
  value,
  onChange,
}: {
  value: ColorBy
  onChange: (v: ColorBy) => void
}) {
  return (
    <SegGroup
      value={value}
      onChange={onChange}
      options={[
        { value: "jobArea", label: "By role" },
        { value: "person", label: "By person" },
      ]}
    />
  )
}

export function DensitySwitcher({
  value,
  onChange,
}: {
  value: Density
  onChange: (v: Density) => void
}) {
  return (
    <SegGroup
      value={value}
      onChange={onChange}
      options={[
        { value: "compact", label: "Compact" },
        { value: "comfortable", label: "Comfortable" },
        { value: "spacious", label: "Spacious" },
      ]}
    />
  )
}

export function ToolbarToggle({
  on,
  onClick,
  icon,
  children,
}: {
  on: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-accent",
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Legend({
  jobAreas,
  jobAreaOrder,
  colorBy,
}: {
  jobAreas: JobAreaLite[]
  jobAreaOrder: Map<string, number>
  colorBy: ColorBy
}) {
  if (colorBy !== "jobArea" || jobAreas.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {jobAreas.map((j) => {
        const c = shiftColor(
          { jobAreaId: j.id, employeeId: "x" } as GridEvent,
          "jobArea",
          jobAreaOrder,
        )
        return (
          <span
            key={j.id}
            className="flex items-center gap-1.5 text-xs text-foreground"
          >
            <span
              className="h-3 w-3 rounded"
              style={{ background: c.bg, border: `1.5px solid ${c.edge}` }}
            />
            {j.name}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crew roster
// ---------------------------------------------------------------------------

function Avatar({ id, initials, size = 32 }: { id: string; initials: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: personColor(id),
        boxShadow: "inset 0 -2px 0 rgba(0,0,0,.1)",
      }}
    >
      {initials}
    </span>
  )
}

export function CrewRoster({
  rows,
}: {
  rows: { emp: EmployeeLite; hours: number; cap: number | null }[]
}) {
  return (
    <ul className="flex max-h-[360px] flex-col divide-y divide-border/70 overflow-y-auto">
      {rows.map(({ emp, hours, cap }) => {
        const over = cap != null && hours > cap
        return (
          <li key={emp.id} className="flex items-center gap-2.5 px-4 py-2.5">
            <Avatar
              id={emp.id}
              initials={`${emp.first_name?.[0] ?? ""}${emp.last_name?.[0] ?? ""}`.toUpperCase()}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {emp.first_name} {emp.last_name}
                {emp.is_minor ? (
                  <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-warning-soft-foreground">
                    minor
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div
                className={cn(
                  "font-mono text-sm font-semibold tabular-nums",
                  over ? "text-destructive" : "text-foreground",
                )}
              >
                {roundHours(hours)}
                {cap != null ? `/${cap}` : ""}h
              </div>
            </div>
          </li>
        )
      })}
      {rows.length === 0 ? (
        <li className="px-4 py-6 text-sm text-muted-foreground">
          No assigned hours this week.
        </li>
      ) : null}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Shift detail (right rail, replaces Open shifts panel when a shift is picked)
// ---------------------------------------------------------------------------

function DetailChip({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-secondary px-2.5 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {k}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{v}</div>
    </div>
  )
}

export function ShiftDetail({
  event,
  employees,
  jobAreas,
  hourlyRate,
  pending,
  onAssign,
  onDuplicate,
  onDelete,
  onEdit,
  onClose,
}: {
  event: GridEvent
  employees: EmployeeLite[]
  jobAreas: JobAreaLite[]
  hourlyRate: number
  pending: boolean
  onAssign: (patch: { employeeId?: string | null; jobAreaId?: string | null }) => void
  onDuplicate: () => void
  onDelete: () => void
  onEdit: () => void
  onClose: () => void
}) {
  const dur = Math.max(0, (event.end.getTime() - event.start.getTime()) / 3_600_000)
  const sH = event.start.getHours() + event.start.getMinutes() / 60
  const eH = event.end.getHours() + event.end.getMinutes() / 60
  const dateLabel = event.start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })

  return (
    <Card className="relative gap-3 p-4">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
        aria-label="Close shift detail"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-module-scheduling">
          Shift detail
        </div>
        <h3 className="font-display text-[22px] leading-none tracking-tight text-foreground">
          {dateLabel} · {fmtHour(sH)}–{fmtHour(eH)}
        </h3>
      </div>

      <div className="flex flex-col gap-2.5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">
            Employee
          </span>
          <Select
            value={event.employeeId ?? OPEN_VALUE}
            onValueChange={(v) =>
              onAssign({ employeeId: v === OPEN_VALUE ? null : v })
            }
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OPEN_VALUE}>Open / unassigned</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.first_name} {e.last_name}
                  {e.is_minor ? " (minor)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">
            Job area
          </span>
          <Select
            value={event.jobAreaId ?? NONE_VALUE}
            onValueChange={(v) =>
              onAssign({ jobAreaId: v === NONE_VALUE ? null : v })
            }
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>— None —</SelectItem>
              {jobAreas.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <DetailChip k="Duration" v={`${roundHours(dur)}h`} />
        <DetailChip k="Break" v={`${event.breakMinutes}m`} />
        <DetailChip k="Est. pay" v={`$${Math.round(dur * hourlyRate)}`} />
      </div>

      <div className="flex gap-2">
        <Button type="button" className="flex-1" disabled={pending} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onDuplicate}
        >
          <Copy className="h-3.5 w-3.5" /> Duplicate
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={pending}
          onClick={onDelete}
          aria-label="Delete shift"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  )
}
