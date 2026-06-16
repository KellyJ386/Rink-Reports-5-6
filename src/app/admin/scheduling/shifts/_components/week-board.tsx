"use client"

import { useCallback, useMemo, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  LayoutGrid,
  Plus,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import type { EmployeeLite, JobAreaLite, TemplateRow } from "../../_lib/types"
import type {
  GridShiftDTO,
  GridTemplateDTO,
} from "../../_lib/grid-actions"
import {
  createGridShift,
  deleteGridShift,
  previewShiftWarnings,
  saveGridTemplate,
  updateGridShift,
} from "../../_lib/grid-actions"
import { hhmmToMinutes, type OperatingHours } from "../../_lib/operating-hours"
import {
  tallyWeeklyHoursByEmployee,
  type TallyItem,
} from "../../_lib/weekly-hours"
import {
  OpenShiftsPanel,
  PendingSwapsPanel,
  PendingTimeOffPanel,
  type EmployeeOption,
  type OpenShiftItem,
  type PendingSwap,
  type PendingTimeOff,
} from "../../_components/hub-panels"
import { PublishButton } from "./publish-button"
import { ApplyTemplateForm } from "./apply-template-form"
import {
  AssignPopover,
  NONE_VALUE,
  OPEN_VALUE,
  type PopoverState,
} from "./assign-popover"
import {
  ColorBySwitcher,
  CrewRoster,
  DensitySwitcher,
  KpiStrip,
  Legend,
  ShiftDetail,
  ToolbarToggle,
} from "./board-pieces"
import { WeekGrid } from "./week-grid"
import {
  dtoToEvent,
  type BoardView,
  type ColorBy,
  type Density,
  type GridEvent,
} from "../_lib/board-model"

const DEFAULT_HOURLY_RATE = 26
const ROW_H: Record<Density, number> = {
  compact: 22,
  comfortable: 30,
  spacious: 38,
}

function parseLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso)
  d.setHours(0, 0, 0, 0)
  return d
}

function addLocalDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(d.getDate() + days)
  next.setHours(0, 0, 0, 0)
  return next
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isoDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type WeekBoardProps = {
  initialShifts: GridShiftDTO[]
  employees: EmployeeLite[]
  jobAreas: JobAreaLite[]
  templates: TemplateRow[]
  operatingHours: OperatingHours
  weekStartDay: number
  defaultDateIso: string
  weekStartsAtIso: string
  weekEndsAtIso: string
  weekLabel: string
  openShifts: OpenShiftItem[]
  employeeOptions: EmployeeOption[]
  pendingSwaps: PendingSwap[]
  pendingTimeOff: PendingTimeOff[]
  swapShiftIds: string[]
}

export function WeekBoard(props: WeekBoardProps) {
  const router = useRouter()
  const pathname = usePathname()

  const [events, setEvents] = useState<GridEvent[]>(() =>
    props.initialShifts.map(dtoToEvent),
  )
  const [view, setView] = useState<BoardView>("week")
  const [colorBy, setColorBy] = useState<ColorBy>("jobArea")
  const [density, setDensity] = useState<Density>("comfortable")
  const [heatmap, setHeatmap] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Popover (create/edit) state + advisory warnings.
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [popoverError, setPopoverError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [warningBlocking, setWarningBlocking] = useState(false)
  const [warnLoading, setWarnLoading] = useState(false)
  const warnTokenRef = useRef(0)

  const anchor = useMemo(
    () => parseLocalDate(props.defaultDateIso),
    [props.defaultDateIso],
  )
  const weekStart = useMemo(() => {
    const wsd = ((props.weekStartDay % 7) + 7) % 7
    const offset = (anchor.getDay() - wsd + 7) % 7
    return addLocalDays(anchor, -offset)
  }, [anchor, props.weekStartDay])

  const days = useMemo(() => {
    if (view === "day") return [anchor]
    return Array.from({ length: 7 }, (_, i) => addLocalDays(weekStart, i))
  }, [view, anchor, weekStart])

  const now = useMemo(() => new Date(), [])
  const todayIndex = days.findIndex((d) => sameLocalDay(d, now))
  const nowHour =
    todayIndex >= 0 ? now.getHours() + now.getMinutes() / 60 : null

  const hourStart = Math.floor(hhmmToMinutes(props.operatingHours.start) / 60)
  const hourEnd = Math.ceil(hhmmToMinutes(props.operatingHours.end) / 60)
  const rowH = ROW_H[density]

  const jobAreaOrder = useMemo(
    () => new Map(props.jobAreas.map((j, i) => [j.id, i])),
    [props.jobAreas],
  )
  const jobAreaNameById = useMemo(
    () => new Map(props.jobAreas.map((j) => [j.id, j.name])),
    [props.jobAreas],
  )
  const swapShiftIds = useMemo(
    () => new Set(props.swapShiftIds),
    [props.swapShiftIds],
  )

  // Visible-week window (local) for KPI + crew tallies.
  const weekWindow = useMemo(() => {
    const start = view === "day" ? anchor : weekStart
    const span = view === "day" ? 1 : 7
    const end = addLocalDays(start, span)
    return { startMs: start.getTime(), endMs: end.getTime() }
  }, [view, anchor, weekStart])

  const weekEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          e.start.getTime() >= weekWindow.startMs &&
          e.start.getTime() < weekWindow.endMs,
      ),
    [events, weekWindow],
  )

  const scheduledHours = useMemo(
    () =>
      weekEvents.reduce(
        (a, e) =>
          a +
          Math.max(
            0,
            (e.end.getTime() - e.start.getTime()) / 3_600_000 -
              (e.breakMinutes || 0) / 60,
          ),
        0,
      ),
    [weekEvents],
  )

  const crewRows = useMemo(() => {
    const items: TallyItem[] = weekEvents.map((e) => ({
      employeeId: e.employeeId,
      startMs: e.start.getTime(),
      endMs: e.end.getTime(),
      breakMinutes: e.breakMinutes,
    }))
    const totals = tallyWeeklyHoursByEmployee(
      items,
      weekWindow.startMs,
      weekWindow.endMs,
    )
    return props.employees
      .map((emp) => ({
        emp,
        hours: totals.get(emp.id) ?? 0,
        cap: emp.max_weekly_hours ?? null,
      }))
      .filter((r) => r.hours > 0)
      .sort((a, b) => b.hours - a.hours)
  }, [weekEvents, weekWindow, props.employees])

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  )

  // ---- Optimistic helpers ----
  const replaceEvent = useCallback((id: string, dto: GridShiftDTO) => {
    setEvents((evs) => evs.map((e) => (e.id === id ? dtoToEvent(dto) : e)))
  }, [])
  const patchEvent = useCallback(
    (id: string, partial: Partial<GridEvent>) => {
      setEvents((evs) =>
        evs.map((e) => (e.id === id ? { ...e, ...partial } : e)),
      )
    },
    [],
  )

  // ---- Advisory warnings ----
  const refreshWarnings = useCallback((next: PopoverState) => {
    const employee_id = next.employeeId === OPEN_VALUE ? null : next.employeeId
    if (!employee_id) {
      warnTokenRef.current++
      setWarnings([])
      setWarningBlocking(false)
      setWarnLoading(false)
      return
    }
    const job_area_id = next.jobAreaId === NONE_VALUE ? null : next.jobAreaId
    const exclude_shift_id = next.mode === "edit" ? next.eventId : null
    const token = ++warnTokenRef.current
    setWarnLoading(true)
    previewShiftWarnings({
      employee_id,
      job_area_id,
      starts_at: next.start.toISOString(),
      ends_at: next.end.toISOString(),
      exclude_shift_id,
    })
      .then((res) => {
        if (token !== warnTokenRef.current) return
        setWarnings(res.ok ? res.data.warnings : [])
        setWarningBlocking(res.ok ? res.data.blocking : false)
      })
      .finally(() => {
        if (token === warnTokenRef.current) setWarnLoading(false)
      })
  }, [])

  const openPopover = useCallback(
    (next: PopoverState) => {
      setPopoverError(null)
      setWarnings([])
      setPopover(next)
      refreshWarnings(next)
    },
    [refreshWarnings],
  )
  const closePopover = useCallback(() => {
    warnTokenRef.current++
    setPopoverError(null)
    setWarnings([])
    setPopover(null)
  }, [])

  // ---- Grid interaction callbacks ----
  const handleCreate = useCallback(
    (start: Date, end: Date) => {
      openPopover({
        mode: "create",
        start,
        end,
        employeeId: OPEN_VALUE,
        jobAreaId: NONE_VALUE,
      })
    },
    [openPopover],
  )

  const handleCommitTimes = useCallback(
    (id: string, start: Date, end: Date) => {
      const prev = events.find((e) => e.id === id)
      if (!prev) return
      const prevStart = prev.start
      const prevEnd = prev.end
      patchEvent(id, { start, end })
      startTransition(async () => {
        const res = await updateGridShift({
          id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
        })
        if (!res.ok) {
          patchEvent(id, { start: prevStart, end: prevEnd })
          toast.error(res.error)
        } else {
          replaceEvent(id, res.data)
        }
      })
    },
    [events, patchEvent, replaceEvent],
  )

  const handleSelect = useCallback(
    (id: string) => setSelectedId((cur) => (cur === id ? null : id)),
    [],
  )

  // ---- Shift detail actions ----
  const handleAssign = useCallback(
    (id: string, patch: { employeeId?: string | null; jobAreaId?: string | null }) => {
      const prev = events.find((e) => e.id === id)
      if (!prev) return
      patchEvent(id, {
        ...(patch.employeeId !== undefined
          ? { employeeId: patch.employeeId }
          : {}),
        ...(patch.jobAreaId !== undefined ? { jobAreaId: patch.jobAreaId } : {}),
      })
      startTransition(async () => {
        const res = await updateGridShift({
          id,
          ...(patch.employeeId !== undefined
            ? { employee_id: patch.employeeId }
            : {}),
          ...(patch.jobAreaId !== undefined
            ? { job_area_id: patch.jobAreaId }
            : {}),
        })
        if (!res.ok) {
          patchEvent(id, {
            employeeId: prev.employeeId,
            jobAreaId: prev.jobAreaId,
          })
          toast.error(res.error)
        } else {
          replaceEvent(id, res.data)
        }
      })
    },
    [events, patchEvent, replaceEvent],
  )

  const handleDuplicate = useCallback(
    (ev: GridEvent) => {
      startTransition(async () => {
        const res = await createGridShift({
          starts_at: ev.start.toISOString(),
          ends_at: ev.end.toISOString(),
          employee_id: ev.employeeId,
          job_area_id: ev.jobAreaId,
          department_id: ev.departmentId,
          break_minutes: ev.breakMinutes,
          role_label: ev.roleLabel,
        })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        setEvents((evs) => [...evs, dtoToEvent(res.data)])
        toast.success("Shift duplicated.")
      })
    },
    [],
  )

  const handleDelete = useCallback(
    (id: string) => {
      startTransition(async () => {
        const res = await deleteGridShift(id)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        setEvents((evs) => evs.filter((e) => e.id !== id))
        setSelectedId((cur) => (cur === id ? null : cur))
        toast.success("Shift deleted.")
      })
    },
    [],
  )

  // ---- Popover save / delete / template ----
  const handlePopoverSave = useCallback(() => {
    if (!popover) return
    setPopoverError(null)
    const employee_id =
      popover.employeeId === OPEN_VALUE ? null : popover.employeeId
    const job_area_id = popover.jobAreaId === NONE_VALUE ? null : popover.jobAreaId

    if (popover.mode === "create") {
      const { start, end } = popover
      startTransition(async () => {
        const res = await createGridShift({
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          employee_id,
          job_area_id,
        })
        if (!res.ok) {
          setPopoverError(res.error)
          return
        }
        setEvents((evs) => [...evs, dtoToEvent(res.data)])
        toast.success("Shift created.")
        closePopover()
      })
    } else {
      const id = popover.eventId
      startTransition(async () => {
        const res = await updateGridShift({ id, employee_id, job_area_id })
        if (!res.ok) {
          setPopoverError(res.error)
          return
        }
        replaceEvent(id, res.data)
        toast.success("Shift updated.")
        closePopover()
      })
    }
  }, [popover, replaceEvent, closePopover])

  const handlePopoverDelete = useCallback(() => {
    if (!popover || popover.mode !== "edit") return
    handleDelete(popover.eventId)
    closePopover()
  }, [popover, handleDelete, closePopover])

  const handleSaveTemplate = useCallback(
    (name: string) => {
      if (!popover) return
      const { start, end } = popover
      const job_area_id =
        popover.jobAreaId === NONE_VALUE ? null : popover.jobAreaId
      const pad = (n: number) => String(n).padStart(2, "0")
      const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:00`
      startTransition(async () => {
        const res: { ok: true; data: GridTemplateDTO } | { ok: false; error: string } =
          await saveGridTemplate({
            name,
            job_area_id,
            day_of_week: start.getDay(),
            start_time: hhmm(start),
            end_time: hhmm(end),
            break_minutes: 0,
          })
        if (!res.ok) {
          setPopoverError(res.error)
          return
        }
        toast.success(`Saved template "${res.data.name}".`)
      })
    },
    [popover],
  )

  // ---- Toolbar actions ----
  const navigate = useCallback(
    (delta: number) => {
      const span = view === "day" ? 1 : 7
      const next = addLocalDays(anchor, delta * span)
      router.replace(`${pathname}?date=${isoDateKey(next)}`, { scroll: false })
    },
    [anchor, view, router, pathname],
  )
  const goToday = useCallback(() => {
    router.replace(`${pathname}?date=${isoDateKey(new Date())}`, {
      scroll: false,
    })
  }, [router, pathname])

  const onViewChange = useCallback((v: BoardView) => {
    if (v === "month") {
      toast.info("Month view is coming soon — showing the week.")
      return
    }
    setView(v)
  }, [])

  const handleAddShift = useCallback(() => {
    const start = new Date(anchor)
    start.setHours(Math.min(hourEnd - 1, hourStart + 3), 0, 0, 0)
    const end = new Date(start)
    end.setHours(Math.min(hourEnd, start.getHours() + 8), 0, 0, 0)
    handleCreate(start, end)
  }, [anchor, hourStart, hourEnd, handleCreate])

  const exportCsv = useCallback(() => {
    const rows = [["Date", "Day", "Start", "End", "Employee", "Job area", "Status"]]
    const empById = new Map(props.employees.map((e) => [e.id, e]))
    for (const e of [...weekEvents].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    )) {
      const emp = e.employeeId ? empById.get(e.employeeId) : null
      const t = (d: Date) =>
        d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      rows.push([
        e.start.toLocaleDateString("en-US"),
        e.start.toLocaleDateString("en-US", { weekday: "short" }),
        t(e.start),
        t(e.end),
        emp ? `${emp.first_name} ${emp.last_name}` : "Open",
        e.jobAreaId ? (jobAreaNameById.get(e.jobAreaId) ?? "") : "",
        e.status,
      ])
    }
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `schedule-${isoDateKey(days[0])}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [weekEvents, props.employees, jobAreaNameById, days])

  const weekRangeLabel = useMemo(() => {
    const first = days[0]
    const last = days[days.length - 1]
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    return view === "day"
      ? first.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
      : `${fmt(first)} – ${fmt(last)} · ${last.getFullYear()}`
  }, [days, view])

  return (
    <div className="flex flex-col gap-4">
      {/* Week nav + view + CTAs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-accent"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {weekRangeLabel}
          </div>
          <button
            type="button"
            onClick={() => navigate(1)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-accent"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <Button type="button" variant="outline" className="h-9" onClick={goToday}>
            Today
          </Button>
        </div>

        <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {(["day", "week", "month"] as BoardView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              aria-pressed={view === v}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors",
                view === v
                  ? "bg-sidebar text-sidebar-foreground"
                  : "text-foreground/80 hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="h-9" onClick={handleAddShift}>
            <Plus className="h-4 w-4" /> Add shift
          </Button>
          <PublishButton
            startsAtIso={props.weekStartsAtIso}
            endsAtIso={props.weekEndsAtIso}
            label={`Request publish · ${props.weekLabel}`}
          />
        </div>
      </div>

      {showTemplate ? (
        <ApplyTemplateForm
          templates={props.templates}
          onClose={() => setShowTemplate(false)}
        />
      ) : null}

      <KpiStrip
        scheduledHours={scheduledHours}
        shiftCount={weekEvents.length}
        employeeCount={props.employees.length}
        openShiftCount={props.openShifts.length}
        swapCount={props.pendingSwaps.length}
        hourlyRate={DEFAULT_HOURLY_RATE}
      />

      {/* Sub-toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <ColorBySwitcher value={colorBy} onChange={setColorBy} />
        <ToolbarToggle
          on={heatmap}
          onClick={() => setHeatmap((v) => !v)}
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
        >
          Coverage heatmap
        </ToolbarToggle>
        <DensitySwitcher value={density} onChange={setDensity} />
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => setShowTemplate((v) => !v)}
        >
          {showTemplate ? "Hide template" : "Apply template…"}
        </Button>
        <div className="flex-1" />
        <Legend jobAreas={props.jobAreas} jobAreaOrder={jobAreaOrder} colorBy={colorBy} />
        <Button type="button" variant="outline" className="h-9" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      {/* Grid + right rail */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <WeekGrid
          events={events}
          employees={props.employees}
          jobAreaOrder={jobAreaOrder}
          days={days}
          todayIndex={todayIndex}
          hourStart={hourStart}
          hourEnd={hourEnd}
          rowH={rowH}
          colorBy={colorBy}
          heatmap={heatmap}
          nowHour={nowHour}
          selectedId={selectedId}
          swapShiftIds={swapShiftIds}
          density={density}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onCommitTimes={handleCommitTimes}
        />

        <div className="flex flex-col gap-3.5">
          {selectedEvent ? (
            <ShiftDetail
              event={selectedEvent}
              employees={props.employees}
              jobAreas={props.jobAreas}
              hourlyRate={DEFAULT_HOURLY_RATE}
              pending={isPending}
              onAssign={(patch) => handleAssign(selectedEvent.id, patch)}
              onDuplicate={() => handleDuplicate(selectedEvent)}
              onDelete={() => handleDelete(selectedEvent.id)}
              onEdit={() =>
                openPopover({
                  mode: "edit",
                  eventId: selectedEvent.id,
                  start: selectedEvent.start,
                  end: selectedEvent.end,
                  employeeId: selectedEvent.employeeId ?? OPEN_VALUE,
                  jobAreaId: selectedEvent.jobAreaId ?? NONE_VALUE,
                })
              }
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <RailCard title="Open shifts" subtitle={`${props.openShifts.length} need coverage`}>
              <OpenShiftsPanel
                rows={props.openShifts}
                employeeOptions={props.employeeOptions}
              />
            </RailCard>
          )}

          <RailCard title="Swap requests">
            <PendingSwapsPanel rows={props.pendingSwaps} />
          </RailCard>

          <RailCard title="Time-off">
            <PendingTimeOffPanel rows={props.pendingTimeOff} />
          </RailCard>

          <RailCard title={`Crew · ${props.employees.length}`}>
            <CrewRoster rows={crewRows} />
          </RailCard>

          <Link
            href="/reports/scheduling"
            className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open the staff scheduling app
          </Link>
        </div>
      </div>

      {popover ? (
        <AssignPopover
          state={popover}
          error={popoverError}
          warnings={warnings}
          warningsBlocking={warningBlocking}
          warningsLoading={warnLoading}
          employees={props.employees}
          jobAreas={props.jobAreas}
          pending={isPending}
          onChange={(next) => {
            setPopoverError(null)
            setPopover(next)
            refreshWarnings(next)
          }}
          onSave={handlePopoverSave}
          onDelete={handlePopoverDelete}
          onSaveTemplate={handleSaveTemplate}
          onClose={closePopover}
        />
      ) : null}
    </div>
  )
}

function RailCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <header className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <h3 className="font-display text-[15px] uppercase tracking-[0.02em] text-foreground">
          {title}
        </h3>
        {subtitle ? (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </header>
      <div>{children}</div>
    </Card>
  )
}
