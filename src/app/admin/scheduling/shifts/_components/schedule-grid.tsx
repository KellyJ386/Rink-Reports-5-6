"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
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
import { format, getDay, parse, startOfWeek } from "date-fns"
import { enUS } from "date-fns/locale"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
  updateGridShift,
  type GridShiftDTO,
} from "../../_lib/grid-actions"

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
  operatingHours: OperatingHours
  /** 0=Sunday .. 6=Saturday (facility setting). */
  weekStartDay: number
  /** ISO date the grid should open on. */
  defaultDateIso: string
}

export function ScheduleGrid({
  employees,
  jobAreas,
  initialShifts,
  operatingHours,
  weekStartDay,
  defaultDateIso,
}: Props) {
  const empById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees]
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

  const [events, setEvents] = useState<GridEvent[]>(() =>
    initialShifts.map((s) => dtoToEvent(s, empById))
  )
  const [date, setDate] = useState<Date>(() => new Date(defaultDateIso))
  const [view, setView] = useState<View>("week")
  const [liveRange, setLiveRange] = useState<string | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [isPending, startTransition] = useTransition()

  const min = useMemo(
    () => timeOnDay(date, operatingHours.start),
    [date, operatingHours.start]
  )
  const max = useMemo(
    () => timeOnDay(date, operatingHours.end),
    [date, operatingHours.end]
  )

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

  const handleSelectSlot = useCallback((slot: SlotInfo) => {
    setLiveRange(null)
    const start = asDate(slot.start)
    let end = asDate(slot.end)
    // A plain click selects a single slot; give it a sensible default length.
    if (end.getTime() - start.getTime() < 15 * 60 * 1000) {
      end = new Date(start.getTime() + 60 * 60 * 1000)
    }
    setPopover({ mode: "create", start, end, employeeId: OPEN_VALUE, jobAreaId: NONE_VALUE })
  }, [])

  // ---- Edit (click an existing event) ----
  const handleSelectEvent = useCallback((event: GridEvent) => {
    setPopover({
      mode: "edit",
      eventId: event.resource.id,
      start: event.start,
      end: event.end,
      employeeId: event.resource.employeeId ?? OPEN_VALUE,
      jobAreaId: event.resource.jobAreaId ?? NONE_VALUE,
    })
  }, [])

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
          toast.error(res.error)
          return
        }
        setEvents((evts) => [...evts, dtoToEvent(res.data, empById)])
        toast.success("Shift created.")
        setPopover(null)
      })
    } else {
      const id = popover.eventId
      startTransition(async () => {
        const res = await updateGridShift({ id, employee_id, job_area_id })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        replaceEvent(id, dtoToEvent(res.data, empById))
        toast.success("Shift updated.")
        setPopover(null)
      })
    }
  }, [popover, empById, replaceEvent])

  const handlePopoverDelete = useCallback(() => {
    if (!popover || popover.mode !== "edit") return
    const id = popover.eventId
    startTransition(async () => {
      const res = await deleteGridShift(id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setEvents((evts) => evts.filter((e) => e.resource.id !== id))
      toast.success("Shift deleted.")
      setPopover(null)
    })
  }, [popover])

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
        {liveRange ? (
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

      <DnDCalendar
        localizer={localizer}
        events={events}
        defaultView="week"
        view={view}
        onView={(v) => setView(v)}
        views={["week", "day"]}
        date={date}
        onNavigate={(d) => setDate(d)}
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
        components={components}
        eventPropGetter={eventPropGetter}
        style={{ height: 680 }}
      />

      {popover ? (
        <AssignPopover
          state={popover}
          employees={employees}
          jobAreas={jobAreas}
          pending={isPending}
          onChange={setPopover}
          onSave={handlePopoverSave}
          onDelete={handlePopoverDelete}
          onClose={() => setPopover(null)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lightweight assign popover (no Dialog primitive in the design system; a small
// centered overlay keeps it touch-friendly).
// ---------------------------------------------------------------------------

function AssignPopover({
  state,
  employees,
  jobAreas,
  pending,
  onChange,
  onSave,
  onDelete,
  onClose,
}: {
  state: PopoverState
  employees: EmployeeLite[]
  jobAreas: JobAreaLite[]
  pending: boolean
  onChange: (next: PopoverState) => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
}) {
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
            <Button type="button" disabled={pending} onClick={onSave}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
