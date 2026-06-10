"use client"

import { useCallback, useMemo, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Calendar,
  dateFnsLocalizer,
  type Components,
  type Event as RbcEvent,
  type SlotInfo,
  type View,
} from "react-big-calendar"
import withDragAndDrop, {
  type EventInteractionArgs,
} from "react-big-calendar/lib/addons/dragAndDrop"
import { addDays, format, getDay, parse, startOfWeek } from "date-fns"
import { enUS } from "date-fns/locale"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import type { EmployeeLite, JobAreaLite } from "../../_lib/types"
import type { OperatingHours } from "../../_lib/operating-hours"
import { timeOnDay } from "../../_lib/operating-hours"
import {
  createGridShift,
  deleteGridShift,
  previewShiftWarnings,
  saveGridTemplate,
  updateGridShift,
  type GridShiftDTO,
  type GridTemplateDTO,
} from "../../_lib/grid-actions"
import {
  roundHours,
  tallyWeeklyHoursByEmployee,
  type TallyItem,
} from "../../_lib/weekly-hours"

// Vendor calendar CSS + DnD addon CSS, then our brand override (last wins).
import "react-big-calendar/lib/css/react-big-calendar.css"
import "react-big-calendar/lib/addons/dragAndDrop/styles.css"
import "./rbc-brand.css"

const OPEN_VALUE = "__open__"
const NONE_VALUE = "__none__"

// ---------------------------------------------------------------------------
// Event model — extra per-shift data lives on `resource` (rbc's typed slot for
// app data); start/end/title are the standard rbc Event fields.
// ---------------------------------------------------------------------------

type ShiftResource = {
  id: string
  employeeId: string | null
  jobAreaId: string | null
  departmentId: string | null
  status: GridShiftDTO["status"]
  breakMinutes: number
  roleLabel: string | null
  notes: string | null
}

type GridEvent = RbcEvent & {
  start: Date
  end: Date
  resource: ShiftResource
}

const DnDCalendar = withDragAndDrop<GridEvent>(Calendar)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}

function formatRange(start: Date, end: Date): string {
  return `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`
}

function initialsFor(emp: EmployeeLite | undefined | null): string {
  if (!emp) return "Open"
  const a = emp.first_name?.[0] ?? ""
  const b = emp.last_name?.[0] ?? ""
  const combined = `${a}${b}`.toUpperCase()
  return combined || "—"
}

function dtoToEvent(
  dto: GridShiftDTO,
  empById: Map<string, EmployeeLite>
): GridEvent {
  const emp = dto.employee_id ? empById.get(dto.employee_id) : null
  return {
    title: initialsFor(emp),
    start: new Date(dto.starts_at),
    end: new Date(dto.ends_at),
    resource: {
      id: dto.id,
      employeeId: dto.employee_id,
      jobAreaId: dto.job_area_id,
      departmentId: dto.department_id,
      status: dto.status,
      breakMinutes: dto.break_minutes,
      roleLabel: dto.role_label,
      notes: dto.notes,
    },
  }
}

// ---------------------------------------------------------------------------
// Assign popover state
// ---------------------------------------------------------------------------

type PopoverState =
  | {
      mode: "create"
      start: Date
      end: Date
      employeeId: string
      jobAreaId: string
    }
  | {
      mode: "edit"
      eventId: string
      start: Date
      end: Date
      employeeId: string
      jobAreaId: string
    }

type Props = {
  employees: EmployeeLite[]
  jobAreas: JobAreaLite[]
  initialShifts: GridShiftDTO[]
  initialTemplates: GridTemplateDTO[]
  operatingHours: OperatingHours
  /** 0=Sunday .. 6=Saturday (facility setting). */
  weekStartDay: number
  /** ISO date the grid should open on. */
  defaultDateIso: string
}

/** Build a Date on `day`'s calendar date at the given "HH:MM[:SS]" local time. */
function combineDayTime(day: Date, hhmmss: string): Date {
  const [h, m, s] = hhmmss.split(":")
  const d = new Date(day)
  d.setHours(Number(h) || 0, Number(m) || 0, Number(s) || 0, 0)
  return d
}

function formatTimeOfDay(hhmmss: string): string {
  return format(combineDayTime(new Date(), hhmmss), "h:mm a")
}

export function ScheduleGrid({
  employees,
  jobAreas,
  initialShifts,
  initialTemplates,
  operatingHours,
  weekStartDay,
  defaultDateIso,
}: Props) {
  const empById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees]
  )
  const jobAreaById = useMemo(
    () => new Map(jobAreas.map((j) => [j.id, j])),
    [jobAreas]
  )

  const localizer = useMemo(
    () =>
      dateFnsLocalizer({
        format,
        parse,
        startOfWeek: (date: Date) =>
          startOfWeek(date, {
            weekStartsOn: (((weekStartDay % 7) + 7) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
          }),
        getDay,
        locales: { "en-US": enUS },
      }),
    [weekStartDay]
  )

  const router = useRouter()
  const pathname = usePathname()

  const [events, setEvents] = useState<GridEvent[]>(() =>
    initialShifts.map((s) => dtoToEvent(s, empById))
  )
  // The anchor arrives as a UTC-midnight ISO; take its calendar date as a
  // LOCAL date so admins west of UTC don't land on the previous day (which
  // can flip the visible week when the anchor is the week-start day).
  const [date, setDate] = useState<Date>(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(defaultDateIso)
    return m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(defaultDateIso)
  })

  // Events are seeded from a ±28-day server preload around ?date=. Keep the
  // anchor in the URL on navigation so the server refetches (the page keys
  // this component by anchor) instead of silently rendering empty weeks once
  // the user navigates past the preload window — and so reloads keep position.
  const navigate = useCallback(
    (d: Date) => {
      setDate(d)
      const pad = (n: number) => String(n).padStart(2, "0")
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      router.replace(`${pathname}?date=${key}`, { scroll: false })
    },
    [router, pathname]
  )
  const [view, setView] = useState<View>("week")
  const [liveRange, setLiveRange] = useState<string | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [popoverError, setPopoverError] = useState<string | null>(null)
  const [popoverWarnings, setPopoverWarnings] = useState<string[]>([])
  const [warningBlocking, setWarningBlocking] = useState(false)
  const [warnLoading, setWarnLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [templates, setTemplates] = useState<GridTemplateDTO[]>(initialTemplates)
  const [armedTemplateId, setArmedTemplateId] = useState<string | null>(null)
  const warnTokenRef = useRef(0)
  const draggedTemplateRef = useRef<GridTemplateDTO | null>(null)

  const armedTemplate = useMemo(
    () => templates.find((t) => t.id === armedTemplateId) ?? null,
    [templates, armedTemplateId]
  )

  // Fetch advisory warnings for a candidate assignment. Driven imperatively from
  // popover open/change (not an effect) so there's no synchronous setState in an
  // effect body; a token guards against out-of-order responses.
  const refreshWarnings = useCallback((next: PopoverState) => {
    const employee_id = next.employeeId === OPEN_VALUE ? null : next.employeeId
    if (!employee_id) {
      warnTokenRef.current++
      setPopoverWarnings([])
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
        setPopoverWarnings(res.ok ? res.data.warnings : [])
        setWarningBlocking(res.ok ? res.data.blocking : false)
      })
      .finally(() => {
        if (token === warnTokenRef.current) setWarnLoading(false)
      })
  }, [])

  const openPopover = useCallback(
    (next: PopoverState) => {
      setPopoverError(null)
      setPopoverWarnings([])
      setPopover(next)
      refreshWarnings(next)
    },
    [refreshWarnings]
  )

  const closePopover = useCallback(() => {
    warnTokenRef.current++
    setPopoverError(null)
    setPopoverWarnings([])
    setPopover(null)
  }, [])

  const min = useMemo(
    () => timeOnDay(date, operatingHours.start),
    [date, operatingHours.start]
  )
  const max = useMemo(
    () => timeOnDay(date, operatingHours.end),
    [date, operatingHours.end]
  )

  const weekStartsOn = useMemo(
    () => (((weekStartDay % 7) + 7) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    [weekStartDay]
  )

  // ---- Per-employee weekly-hours tally for the visible week (side rail) ----
  const weeklyTally = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn })
    const weekEnd = addDays(weekStart, 7)
    const items: TallyItem[] = events.map((e) => ({
      employeeId: e.resource.employeeId,
      startMs: e.start.getTime(),
      endMs: e.end.getTime(),
      breakMinutes: e.resource.breakMinutes,
    }))
    const totals = tallyWeeklyHoursByEmployee(
      items,
      weekStart.getTime(),
      weekEnd.getTime()
    )
    return employees
      .map((emp) => ({
        emp,
        hours: totals.get(emp.id) ?? 0,
        cap: emp.max_weekly_hours ?? null,
      }))
      .filter((row) => row.hours > 0)
      .sort((a, b) => b.hours - a.hours)
  }, [events, employees, date, weekStartsOn])

  // ---- Optimistic event mutation helpers ----
  const replaceEvent = useCallback((id: string, next: GridEvent) => {
    setEvents((evts) => evts.map((e) => (e.resource.id === id ? next : e)))
  }, [])

  const patchEventTimes = useCallback(
    (id: string, start: Date, end: Date) => {
      setEvents((evts) =>
        evts.map((e) =>
          e.resource.id === id ? { ...e, start, end } : e
        )
      )
    },
    []
  )

  // ---- Drag-to-create ----
  const handleSelecting = useCallback(
    (range: { start: Date; end: Date }) => {
      setLiveRange(formatRange(asDate(range.start), asDate(range.end)))
      return true
    },
    []
  )

  // ---- Apply a template to a day (drag-drop or armed-then-tap) ----
  const applyTemplateOnDate = useCallback(
    (tpl: GridTemplateDTO, day: Date) => {
      const start = combineDayTime(day, tpl.start_time)
      const end = combineDayTime(day, tpl.end_time)
      startTransition(async () => {
        const res = await createGridShift({
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          employee_id: null,
          job_area_id: tpl.job_area_id,
          break_minutes: tpl.break_minutes,
        })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        setEvents((evts) => [...evts, dtoToEvent(res.data, empById)])
        toast.success(`Applied "${tpl.name}".`)
      })
    },
    [empById]
  )

  const handleSelectSlot = useCallback(
    (slot: SlotInfo) => {
      setLiveRange(null)
      // When a template is armed, a tap/drag on a day places it there instead
      // of opening the create popover.
      if (armedTemplate) {
        applyTemplateOnDate(armedTemplate, asDate(slot.start))
        setArmedTemplateId(null)
        return
      }
      const start = asDate(slot.start)
      let end = asDate(slot.end)
      // A plain click selects a single slot; give it a sensible default length.
      if (end.getTime() - start.getTime() < 15 * 60 * 1000) {
        end = new Date(start.getTime() + 60 * 60 * 1000)
      }
      openPopover({
        mode: "create",
        start,
        end,
        employeeId: OPEN_VALUE,
        jobAreaId: NONE_VALUE,
      })
    },
    [armedTemplate, applyTemplateOnDate, openPopover]
  )

  // Native drag of a template card onto the grid.
  const handleDropFromOutside = useCallback(
    (args: { start: Date | string }) => {
      const tpl = draggedTemplateRef.current
      draggedTemplateRef.current = null
      setArmedTemplateId(null)
      if (tpl) applyTemplateOnDate(tpl, asDate(args.start))
    },
    [applyTemplateOnDate]
  )

  // Preview event shown while dragging a template over the grid.
  const dragFromOutsideItem = useCallback((): GridEvent => {
    const tpl = draggedTemplateRef.current
    const now = new Date()
    return {
      title: tpl?.name ?? "Template",
      start: now,
      end: new Date(now.getTime() + 60 * 60 * 1000),
      resource: {
        id: "__preview__",
        employeeId: null,
        jobAreaId: tpl?.job_area_id ?? null,
        departmentId: null,
        status: "draft",
        breakMinutes: tpl?.break_minutes ?? 0,
        roleLabel: null,
        notes: null,
      },
    }
  }, [])

  // ---- Save a painted/selected block as a template ----
  const handleSaveTemplate = useCallback(
    (name: string) => {
      if (!popover) return
      const { start, end } = popover
      const job_area_id =
        popover.jobAreaId === NONE_VALUE ? null : popover.jobAreaId
      startTransition(async () => {
        const res = await saveGridTemplate({
          name,
          job_area_id,
          day_of_week: start.getDay(),
          start_time: format(start, "HH:mm:ss"),
          end_time: format(end, "HH:mm:ss"),
          break_minutes: 0,
        })
        if (!res.ok) {
          setPopoverError(res.error)
          return
        }
        setTemplates((t) => [...t, res.data])
        toast.success(`Saved template "${res.data.name}".`)
      })
    },
    [popover]
  )

  // ---- Edit (click an existing event) ----
  const handleSelectEvent = useCallback(
    (event: GridEvent) => {
      openPopover({
        mode: "edit",
        eventId: event.resource.id,
        start: event.start,
        end: event.end,
        employeeId: event.resource.employeeId ?? OPEN_VALUE,
        jobAreaId: event.resource.jobAreaId ?? NONE_VALUE,
      })
    },
    [openPopover]
  )

  // ---- Move + resize (persist via updateGridShift) ----
  const commitTimeChange = useCallback(
    (args: EventInteractionArgs<GridEvent>) => {
      const { event } = args
      const start = asDate(args.start)
      const end = asDate(args.end)
      if (end.getTime() <= start.getTime()) return

      const id = event.resource.id
      const prevStart = event.start
      const prevEnd = event.end
      patchEventTimes(id, start, end)

      startTransition(async () => {
        const res = await updateGridShift({
          id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
        })
        if (!res.ok) {
          patchEventTimes(id, prevStart, prevEnd) // revert
          toast.error(res.error)
        }
      })
    },
    [patchEventTimes]
  )

  // ---- Popover save ----
  const handlePopoverSave = useCallback(() => {
    if (!popover) return
    setPopoverError(null)
    const employee_id =
      popover.employeeId === OPEN_VALUE ? null : popover.employeeId
    const job_area_id =
      popover.jobAreaId === NONE_VALUE ? null : popover.jobAreaId

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
          setPopoverError(res.error) // inline; popover stays open
          return
        }
        setEvents((evts) => [...evts, dtoToEvent(res.data, empById)])
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
        replaceEvent(id, dtoToEvent(res.data, empById))
        toast.success("Shift updated.")
        closePopover()
      })
    }
  }, [popover, empById, replaceEvent, closePopover])

  const handlePopoverDelete = useCallback(() => {
    if (!popover || popover.mode !== "edit") return
    setPopoverError(null)
    const id = popover.eventId
    startTransition(async () => {
      const res = await deleteGridShift(id)
      if (!res.ok) {
        setPopoverError(res.error)
        return
      }
      setEvents((evts) => evts.filter((e) => e.resource.id !== id))
      toast.success("Shift deleted.")
      closePopover()
    })
  }, [popover, closePopover])

  // ---- Rendering bits ----
  const components = useMemo<Components<GridEvent>>(
    () => ({
      event: ({ event }: { event: GridEvent }) => (
        <div className="flex flex-col leading-tight">
          <span className="truncate text-[11px] font-semibold">
            {event.title}
          </span>
          <span className="truncate text-[10px] opacity-80">
            {formatRange(event.start, event.end)}
          </span>
        </div>
      ),
    }),
    []
  )

  const eventPropGetter = useCallback((event: GridEvent) => {
    const { status, employeeId } = event.resource
    const className =
      status === "cancelled"
        ? "rr-shift--cancelled"
        : employeeId
          ? "rr-shift--assigned"
          : "rr-shift--open"
    return { className }
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center gap-2 text-sm">
        {armedTemplate ? (
          <span className="inline-flex items-center gap-2 rounded-md bg-primary/15 px-2 py-0.5 font-medium text-foreground">
            Placing “{armedTemplate.name}” — tap a day to drop it.
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-2"
              onClick={() => setArmedTemplateId(null)}
            >
              Cancel
            </button>
          </span>
        ) : liveRange ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 font-medium text-foreground">
            <span className="text-muted-foreground">Selecting</span>
            {liveRange}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Drag down a day column to create a shift. Drag an event to move it,
            or its edges to resize.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <DnDCalendar
            localizer={localizer}
            events={events}
            defaultView="week"
            view={view}
            onView={(v) => setView(v)}
            views={["week", "day"]}
            date={date}
            onNavigate={navigate}
            step={15}
            timeslots={4}
            min={min}
            max={max}
            scrollToTime={min}
            selectable
            longPressThreshold={250}
            resizable
            onSelecting={handleSelecting}
            onSelectSlot={handleSelectSlot}
            onSelectEvent={handleSelectEvent}
            onEventDrop={commitTimeChange}
            onEventResize={commitTimeChange}
            onDropFromOutside={handleDropFromOutside}
            dragFromOutsideItem={dragFromOutsideItem}
            components={components}
            eventPropGetter={eventPropGetter}
            style={{ height: 680 }}
          />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-60">
          <WeeklyHoursRail rows={weeklyTally} />
          <TemplatesPanel
            templates={templates}
            jobAreaById={jobAreaById}
            armedId={armedTemplateId}
            onToggleArm={(id) =>
              setArmedTemplateId((cur) => (cur === id ? null : id))
            }
            onDragStartTemplate={(tpl) => {
              draggedTemplateRef.current = tpl
            }}
            onDragEndTemplate={() => {
              draggedTemplateRef.current = null
            }}
          />
        </div>
      </div>

      {popover ? (
        <AssignPopover
          state={popover}
          error={popoverError}
          warnings={popoverWarnings}
          warningsBlocking={warningBlocking}
          warningsLoading={warnLoading}
          employees={employees}
          jobAreas={jobAreas}
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

// ---------------------------------------------------------------------------
// Weekly-hours side rail: per-employee total for the visible week vs cap.
// ---------------------------------------------------------------------------

type TallyRow = { emp: EmployeeLite; hours: number; cap: number | null }

function WeeklyHoursRail({ rows }: { rows: TallyRow[] }) {
  return (
    <aside className="w-full shrink-0 rounded-xl border border-border bg-card p-4 lg:w-60">
      <h3 className="mb-2 text-sm font-semibold tracking-tight">
        This week&rsquo;s hours
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No assigned hours this week.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map(({ emp, hours, cap }) => {
            const over = cap != null && hours > cap
            return (
              <li
                key={emp.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate">
                  {emp.first_name} {emp.last_name}
                </span>
                <span
                  className={cn(
                    "tabular-nums font-medium",
                    over ? "text-destructive" : "text-muted-foreground"
                  )}
                  title={
                    cap != null
                      ? `${roundHours(hours)}h of ${cap}h cap`
                      : `${roundHours(hours)}h`
                  }
                >
                  {roundHours(hours)}
                  {cap != null ? `/${cap}` : ""}h
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Templates side panel: saved single-slot templates. Drag a card onto a day, or
// tap to arm it then tap a day to drop it.
// ---------------------------------------------------------------------------

function TemplatesPanel({
  templates,
  jobAreaById,
  armedId,
  onToggleArm,
  onDragStartTemplate,
  onDragEndTemplate,
}: {
  templates: GridTemplateDTO[]
  jobAreaById: Map<string, JobAreaLite>
  armedId: string | null
  onToggleArm: (id: string) => void
  onDragStartTemplate: (tpl: GridTemplateDTO) => void
  onDragEndTemplate: () => void
}) {
  return (
    <aside className="w-full rounded-xl border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold tracking-tight">Templates</h3>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Paint a block and choose “Save as template” to reuse it here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => {
            const armed = t.id === armedId
            const area = t.job_area_id
              ? jobAreaById.get(t.job_area_id)
              : null
            return (
              <li key={t.id}>
                <button
                  type="button"
                  draggable
                  onDragStart={() => onDragStartTemplate(t)}
                  onDragEnd={onDragEndTemplate}
                  onClick={() => onToggleArm(t.id)}
                  aria-pressed={armed}
                  className={cn(
                    "w-full cursor-grab rounded-lg border px-3 py-2 text-left transition-colors active:cursor-grabbing",
                    armed
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:bg-accent"
                  )}
                >
                  <span className="block truncate text-sm font-medium">
                    {t.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatTimeOfDay(t.start_time)} – {formatTimeOfDay(t.end_time)}
                    {area ? ` · ${area.name}` : ""}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Lightweight assign popover (no Dialog primitive in the design system; a small
// centered overlay keeps it touch-friendly).
// ---------------------------------------------------------------------------

function AssignPopover({
  state,
  error,
  warnings,
  warningsBlocking,
  warningsLoading,
  employees,
  jobAreas,
  pending,
  onChange,
  onSave,
  onDelete,
  onSaveTemplate,
  onClose,
}: {
  state: PopoverState
  error: string | null
  warnings: string[]
  warningsBlocking: boolean
  warningsLoading: boolean
  employees: EmployeeLite[]
  jobAreas: JobAreaLite[]
  pending: boolean
  onChange: (next: PopoverState) => void
  onSave: () => void
  onDelete: () => void
  onSaveTemplate: (name: string) => void
  onClose: () => void
}) {
  // When the facility blocks on warnings, a flagged assignment can't be saved.
  const saveBlocked = warningsBlocking && warnings.length > 0
  const [templateMode, setTemplateMode] = useState(false)
  const [templateName, setTemplateName] = useState("")
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-col gap-0.5">
          <h3 className="text-base font-semibold tracking-tight">
            {state.mode === "create" ? "New shift" : "Edit shift"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {format(state.start, "EEE, MMM d")} ·{" "}
            {formatRange(state.start, state.end)}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Employee</span>
            <Select
              value={state.employeeId}
              onValueChange={(v) => onChange({ ...state, employeeId: v })}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Assign employee" />
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
            <span className="font-medium">Job area</span>
            <Select
              value={state.jobAreaId}
              onValueChange={(v) => onChange({ ...state, jobAreaId: v })}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select job area" />
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

        {warningsLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Checking for conflicts…
          </p>
        ) : warnings.length > 0 ? (
          <div
            className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
            role="status"
          >
            <p className="mb-1 font-medium text-foreground">
              {saveBlocked
                ? "Blocked by facility policy:"
                : "Heads up — this assignment:"}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            {!saveBlocked ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Advisory only — you can still save.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {templateMode ? (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
            <label className="text-sm font-medium" htmlFor="rr-template-name">
              Template name
            </label>
            <Input
              id="rr-template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Morning open"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saves this block&rsquo;s times
              {state.jobAreaId !== NONE_VALUE ? " and job area" : ""} as a
              reusable template.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setTemplateMode(false)
                  setTemplateName("")
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending || templateName.trim().length === 0}
                onClick={() => {
                  onSaveTemplate(templateName.trim())
                  setTemplateMode(false)
                  setTemplateName("")
                }}
              >
                Save template
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mt-4 text-left text-sm font-medium text-primary underline underline-offset-2"
            onClick={() => setTemplateMode(true)}
          >
            Save as template
          </button>
        )}

        <div
          className={cn(
            "mt-5 flex items-center gap-2",
            state.mode === "edit" ? "justify-between" : "justify-end"
          )}
        >
          {state.mode === "edit" ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={pending}
              onClick={onDelete}
            >
              Delete
            </Button>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || saveBlocked}
              onClick={onSave}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
