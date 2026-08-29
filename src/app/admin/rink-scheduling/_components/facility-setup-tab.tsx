"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  createHoursException,
  createLockerRoom,
  createRink,
  deleteHoursException,
  deleteLockerRoom,
  deleteRink,
  saveOperatingHours,
  setLockerRoomActive,
  setRinkActive,
  updateLockerRoom,
  updateRink,
} from "../actions"
import { DAY_LABELS, MAX_ACTIVE_RINKS } from "../_lib/config"
import type {
  ActionState,
  HoursExceptionRow,
  LockerRoomRow,
  OperatingHoursRow,
  RinkRow,
} from "../types"
import { SeedDefaultsCard } from "./seed-defaults-card"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  rinks: RinkRow[]
  lockerRooms: LockerRoomRow[]
  hours: OperatingHoursRow[]
  exceptions: HoursExceptionRow[]
}

export function FacilitySetupTab({ rinks, lockerRooms, hours, exceptions }: Props) {
  // A facility with no hours row has never been through setup at all.
  const showSeed = hours.length === 0

  return (
    <div className="flex flex-col gap-6">
      {showSeed && <SeedDefaultsCard />}
      <RinksCard rinks={rinks} />
      <LockerRoomsCard lockerRooms={lockerRooms} rinks={rinks} />
      <OperatingHoursCard hours={hours} />
      <ExceptionsCard exceptions={exceptions} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rinks
// ---------------------------------------------------------------------------

function RinksCard({ rinks }: { rinks: RinkRow[] }) {
  const activeCount = rinks.filter((r) => r.is_active).length
  const atCap = activeCount >= MAX_ACTIVE_RINKS

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rinks ({rinks.length})</CardTitle>
        <CardDescription>
          The ice surfaces this facility books. Each becomes a column on the
          calendar, in the order below. {activeCount} of {MAX_ACTIVE_RINKS}{" "}
          active.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rinks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No rinks yet. Add the first one below — nothing can be booked until
            there is at least one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rinks.map((rink) => (
              <RinkRowItem key={rink.id} rink={rink} atCap={atCap} />
            ))}
          </ul>
        )}
        <RinkCreateForm atCap={atCap} activeCount={activeCount} />
      </CardContent>
    </Card>
  )
}

function RinkRowItem({ rink, atCap }: { rink: RinkRow; atCap: boolean }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateRink, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rink updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setRinkActive(rink.id, !rink.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onDelete() {
    if (!confirm(`Delete rink "${rink.name}"?`)) return
    startDel(async () => {
      const r = await deleteRink(rink.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Rink deleted.")
    })
  }

  // Reactivating is the other way past the cap, so the button says why.
  const reactivateBlocked = !rink.is_active && atCap

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-sm border"
            style={{ backgroundColor: rink.display_color }}
          />
          <span className="font-medium">{rink.name}</span>
          <span className="text-muted-foreground font-mono text-xs">
            {rink.short_code}
          </span>
          {!rink.is_active && (
            <Badge variant="secondary" className="uppercase">
              off
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending || reactivateBlocked}
            title={
              reactivateBlocked
                ? `Already at ${MAX_ACTIVE_RINKS} active rinks. Deactivate another first.`
                : undefined
            }
          >
            {rink.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>

      {editing && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={rink.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-name-${rink.id}`}>Name</Label>
            <Input
              id={`rink-name-${rink.id}`}
              name="name"
              defaultValue={rink.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-code-${rink.id}`}>Short code</Label>
            <Input
              id={`rink-code-${rink.id}`}
              name="short_code"
              defaultValue={rink.short_code}
              maxLength={8}
              required
              className="w-28 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-color-${rink.id}`}>Colour</Label>
            <Input
              id={`rink-color-${rink.id}`}
              name="display_color"
              type="color"
              defaultValue={rink.display_color}
              className="h-9 w-16 p-1"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-sort-${rink.id}`}>Order</Label>
            <Input
              id={`rink-sort-${rink.id}`}
              name="sort_order"
              type="number"
              defaultValue={rink.sort_order}
              className="w-20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-resurface-${rink.id}`}>Resurface (min)</Label>
            <Input
              id={`rink-resurface-${rink.id}`}
              name="resurface_minutes_override"
              type="number"
              min={1}
              max={120}
              defaultValue={rink.resurface_minutes_override ?? ""}
              placeholder="default"
              className="w-28"
              title="Cut duration for this sheet. Blank uses the facility default from the Settings tab."
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rink-buffer-${rink.id}`}>Ice-make (min)</Label>
            <Input
              id={`rink-buffer-${rink.id}`}
              name="buffer_minutes_override"
              type="number"
              min={0}
              max={120}
              defaultValue={rink.buffer_minutes_override ?? ""}
              placeholder="default"
              className="w-28"
              title="Ice-make time for this sheet. Blank uses the facility default from the Settings tab."
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </li>
  )
}

function RinkCreateForm({
  atCap,
  activeCount,
}: {
  atCap: boolean
  activeCount: number
}) {
  const [state, action, pending] = useActionState(createRink, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rink created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  if (atCap) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
        This facility has {activeCount} active rinks, the maximum. Deactivate one
        to add another.
      </p>
    )
  }

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
      key={state.ok === true ? "rink-form-ok" : "rink-form"}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rink-name">Name</Label>
        <Input id="new-rink-name" name="name" placeholder="Main Rink" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rink-code">Short code</Label>
        <Input
          id="new-rink-code"
          name="short_code"
          placeholder="MAIN"
          maxLength={8}
          required
          className="w-28 font-mono"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rink-color">Colour</Label>
        <Input
          id="new-rink-color"
          name="display_color"
          type="color"
          defaultValue="#4DFF00"
          className="h-9 w-16 p-1"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rink-resurface">Resurface (min)</Label>
        <Input
          id="new-rink-resurface"
          name="resurface_minutes_override"
          type="number"
          min={1}
          max={120}
          placeholder="default"
          className="w-28"
          title="Cut duration for this sheet. Blank uses the facility default from the Settings tab."
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rink-buffer">Ice-make (min)</Label>
        <Input
          id="new-rink-buffer"
          name="buffer_minutes_override"
          type="number"
          min={0}
          max={120}
          placeholder="default"
          className="w-28"
          title="Ice-make time for this sheet. Blank uses the facility default from the Settings tab."
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add rink"}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Locker rooms
// ---------------------------------------------------------------------------

function LockerRoomsCard({
  lockerRooms,
  rinks,
}: {
  lockerRooms: LockerRoomRow[]
  rinks: RinkRow[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locker rooms ({lockerRooms.length})</CardTitle>
        <CardDescription>
          Rooms that can be assigned to a booking. The short code is what the
          lobby display shows, so keep it brief.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {lockerRooms.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No locker rooms yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lockerRooms.map((room) => (
              <LockerRoomRowItem key={room.id} room={room} rinks={rinks} />
            ))}
          </ul>
        )}
        <LockerRoomCreateForm rinks={rinks} />
      </CardContent>
    </Card>
  )
}

function LockerRoomRowItem({
  room,
  rinks,
}: {
  room: LockerRoomRow
  rinks: RinkRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateLockerRoom, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Locker room updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setLockerRoomActive(room.id, !room.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onDelete() {
    if (!confirm(`Delete locker room "${room.name}"?`)) return
    startDel(async () => {
      const r = await deleteLockerRoom(room.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Locker room deleted.")
    })
  }

  const rinkName = room.default_rink_id
    ? (rinks.find((r) => r.id === room.default_rink_id)?.name ?? null)
    : null

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{room.name}</span>
          <span className="text-muted-foreground font-mono text-xs">
            {room.short_code}
          </span>
          {room.capacity !== null && (
            <span className="text-muted-foreground text-xs">
              capacity {room.capacity}
            </span>
          )}
          {rinkName && (
            <span className="text-muted-foreground text-xs">· {rinkName}</span>
          )}
          {!room.is_active && (
            <Badge variant="secondary" className="uppercase">
              off
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {room.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>

      {editing && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={room.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`room-name-${room.id}`}>Name</Label>
            <Input
              id={`room-name-${room.id}`}
              name="name"
              defaultValue={room.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`room-code-${room.id}`}>Short code</Label>
            <Input
              id={`room-code-${room.id}`}
              name="short_code"
              defaultValue={room.short_code}
              maxLength={8}
              required
              className="w-24 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`room-cap-${room.id}`}>Capacity</Label>
            <Input
              id={`room-cap-${room.id}`}
              name="capacity"
              type="number"
              min={1}
              max={500}
              defaultValue={room.capacity ?? ""}
              className="w-24"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`room-rink-${room.id}`}>Rink-side</Label>
            <select
              id={`room-rink-${room.id}`}
              name="default_rink_id"
              defaultValue={room.default_rink_id ?? ""}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              <option value="">None</option>
              {rinks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`room-sort-${room.id}`}>Order</Label>
            <Input
              id={`room-sort-${room.id}`}
              name="sort_order"
              type="number"
              defaultValue={room.sort_order}
              className="w-20"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </li>
  )
}

function LockerRoomCreateForm({ rinks }: { rinks: RinkRow[] }) {
  const [state, action, pending] = useActionState(createLockerRoom, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Locker room created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
      key={state.ok === true ? "room-form-ok" : "room-form"}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-room-name">Name</Label>
        <Input id="new-room-name" name="name" placeholder="Locker Room 1" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-room-code">Short code</Label>
        <Input
          id="new-room-code"
          name="short_code"
          placeholder="LR1"
          maxLength={8}
          required
          className="w-24 font-mono"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-room-cap">Capacity</Label>
        <Input
          id="new-room-cap"
          name="capacity"
          type="number"
          min={1}
          max={500}
          className="w-24"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-room-rink">Rink-side</Label>
        <select
          id="new-room-rink"
          name="default_rink_id"
          defaultValue=""
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          <option value="">None</option>
          {rinks.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add locker room"}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Operating hours
//
// One form for the whole week, saved as a single upsert. Times are the
// FACILITY'S local wall clock, never UTC — the note under the grid says so,
// because a rink manager reading "23:00" needs to know it means 11pm at the
// rink and not on a server somewhere.
// ---------------------------------------------------------------------------

function OperatingHoursCard({ hours }: { hours: OperatingHoursRow[] }) {
  const [state, action, pending] = useActionState(saveOperatingHours, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Operating hours saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operating hours</CardTitle>
        <CardDescription>
          When the building is open, in the facility&rsquo;s own local time. A
          booking that falls outside these hours is still allowed — it is
          flagged as a coverage gap rather than blocked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {DAY_LABELS.map((label, day) => {
              const row = byDay.get(day)
              return (
                <li
                  key={day}
                  className="bg-muted/30 flex flex-wrap items-center gap-3 rounded-md border p-3"
                >
                  <span className="w-24 text-sm font-medium">{label}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`closed_${day}`}
                      defaultChecked={row?.is_closed ?? false}
                      className="border-input size-4 rounded border"
                    />
                    Closed
                  </label>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`open-${day}`} className="text-xs">
                      Open
                    </Label>
                    <Input
                      id={`open-${day}`}
                      name={`open_${day}`}
                      type="time"
                      defaultValue={(row?.open_time ?? "06:00").slice(0, 5)}
                      className="w-32"
                    />
                    <Label htmlFor={`close-${day}`} className="text-xs">
                      Close
                    </Label>
                    <Input
                      id={`close-${day}`}
                      name={`close_${day}`}
                      type="time"
                      defaultValue={(row?.close_time ?? "23:00").slice(0, 5)}
                      className="w-32"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-muted-foreground text-xs">
            Times are the facility&rsquo;s local clock. A closing time earlier
            than the opening time means the day runs past midnight — a 6:00 to
            2:00 rink is entered exactly that way.
          </p>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save operating hours"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Holiday / special-day exceptions
// ---------------------------------------------------------------------------

function ExceptionsCard({ exceptions }: { exceptions: HoursExceptionRow[] }) {
  const [state, action, pending] = useActionState(createHoursException, NULL_STATE)
  const [closed, setClosed] = useState(true)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Exception added.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holidays &amp; special days ({exceptions.length})</CardTitle>
        <CardDescription>
          A date listed here replaces that day&rsquo;s usual hours entirely.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {exceptions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No exceptions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {exceptions.map((ex) => (
              <ExceptionRowItem key={ex.id} exception={ex} />
            ))}
          </ul>
        )}

        <form
          action={action}
          className="flex flex-wrap items-end gap-3 rounded-md border p-3"
          key={state.ok === true ? "ex-form-ok" : "ex-form"}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="ex-date">Date</Label>
            <Input id="ex-date" name="exception_date" type="date" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ex-label">Label</Label>
            <Input
              id="ex-label"
              name="label"
              placeholder="Thanksgiving"
              required
            />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_closed"
              checked={closed}
              onChange={(e) => setClosed(e.target.checked)}
              className="border-input size-4 rounded border"
            />
            Closed all day
          </label>
          {!closed && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ex-open">Open</Label>
                <Input
                  id="ex-open"
                  name="open_time"
                  type="time"
                  defaultValue="09:00"
                  className="w-32"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ex-close">Close</Label>
                <Input
                  id="ex-close"
                  name="close_time"
                  type="time"
                  defaultValue="17:00"
                  className="w-32"
                />
              </div>
            </>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add exception"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ExceptionRowItem({ exception }: { exception: HoursExceptionRow }) {
  const [delPending, startDel] = useTransition()

  function onDelete() {
    startDel(async () => {
      const r = await deleteHoursException(exception.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Exception removed.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{exception.exception_date}</span>
        <span className="font-medium">{exception.label}</span>
        {exception.is_closed ? (
          <Badge variant="secondary" className="uppercase">
            closed
          </Badge>
        ) : (
          <span className="text-muted-foreground font-mono text-xs">
            {(exception.open_time ?? "").slice(0, 5)}–
            {(exception.close_time ?? "").slice(0, 5)}
          </span>
        )}
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={delPending}
      >
        Remove
      </Button>
    </li>
  )
}
