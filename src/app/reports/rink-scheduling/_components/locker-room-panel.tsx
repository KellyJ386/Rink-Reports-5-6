"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { formatInTz } from "@/lib/timezone"

import { assignLockerRoom, removeLockerAssignment } from "../locker-actions"
import type { LockerAssignmentView, LockerRoomRow } from "../_lib/types"

// ---------------------------------------------------------------------------
// Locker rooms attached to one saved booking.
//
// Only rendered in edit mode: an assignment needs a booking id, so the room is
// picked after the booking exists rather than as part of creating it. That
// also keeps the create path a single write.
//
// Overlaps are surfaced as toasts, never as rejections — the DB permits them
// deliberately (fast turnover between two teams sharing a room is normal), so
// the action succeeds and tells you what else is in there.
// ---------------------------------------------------------------------------

type Props = {
  bookingId: string
  bookingCancelled: boolean
  rooms: LockerRoomRow[]
  assignments: LockerAssignmentView[]
  timeZone: string | null
  canEdit: boolean
}

export function LockerRoomPanel({
  bookingId,
  bookingCancelled,
  rooms,
  assignments,
  timeZone,
  canEdit,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState("")

  const taken = new Set(assignments.map((a) => a.locker_room_id))
  const available = rooms.filter((r) => r.is_active && !taken.has(r.id))

  function onAssign() {
    if (!choice) return
    startTransition(async () => {
      const res = await assignLockerRoom(bookingId, choice)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setChoice("")
      if (res.warnings.length > 0) {
        // A warning is still a success: the room IS assigned.
        for (const w of res.warnings) toast.warning(w)
      } else {
        toast.success("Locker room assigned.")
      }
    })
  }

  function onRemove(assignmentId: string) {
    startTransition(async () => {
      const res = await removeLockerAssignment(assignmentId)
      if (!res.ok) toast.error(res.error)
      else toast.success("Locker room released.")
    })
  }

  return (
    <fieldset className="border-border flex flex-col gap-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-semibold">Locker rooms</legend>

      {assignments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No locker rooms assigned to this booking.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assignments.map((a) => (
            <li
              key={a.id}
              className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{a.roomName}</span>
                <span className="text-muted-foreground text-xs">
                  {formatInTz(a.occupies_from, timeZone, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" – "}
                  {formatInTz(a.occupies_until, timeZone, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {canEdit && !bookingCancelled && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(a.id)}
                  disabled={pending}
                >
                  Release
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && !bookingCancelled && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <Label htmlFor="bk-locker">Add a room</Label>
            <select
              id="bk-locker"
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={pending || available.length === 0}
            >
              <option value="">
                {available.length === 0
                  ? rooms.length === 0
                    ? "No locker rooms set up"
                    : "All rooms already assigned"
                  : "Select a room…"}
              </option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={onAssign} disabled={pending || !choice}>
            {pending ? "Assigning…" : "Assign"}
          </Button>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Rooms are held from before the booking starts until after it ends, using the
        lead and vacate times set in Admin → Rink Scheduling → Settings.
      </p>
    </fieldset>
  )
}
