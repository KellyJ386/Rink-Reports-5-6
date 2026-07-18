"use client"

// Supervisor/admin assignment board (Phase 4, D5): every active area for the
// day with its assignees, source, and completion state. Inside the
// admin-configured pre-lock window, incomplete ASSIGNED areas sort to the top
// under a warning callout (the day "locks" implicitly at facility-local
// midnight; the lock is never blocked — this view exists so a supervisor can
// reassign or chase before it happens). Editing an area's assignees is a
// checkbox picker + one save (reassignArea = supersede + insert), and
// "Open up" clears all assignees (the area reverts to open for everyone and
// the resolution engine will not re-materialize over it).

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  UserRoundPlus,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card } from "@/components/ui/card"
import { useSyncQueue } from "@/lib/offline/use-sync-queue"
import { cn } from "@/lib/utils"

import {
  reassignArea,
  unassignArea,
  type AssignmentBoard,
} from "../assignment-actions"

type BoardArea = AssignmentBoard["areas"][number]

const SOURCE_LABEL: Record<string, string> = {
  manual: "manual",
  schedule: "from schedule",
  default: "default owner",
}

function AreaRow({
  area,
  date,
  employees,
  flagged,
  isOnline,
}: {
  area: BoardArea
  date: string
  employees: AssignmentBoard["employees"]
  flagged: boolean
  /** Assignment changes are online-only (D9) — no queueing, no conflicts. */
  isOnline: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(area.assignees.map((a) => a.employeeId)),
  )
  const [pending, startTransition] = useTransition()

  const accent = area.color?.trim() || null
  const assigned = area.assignees.length > 0

  function save() {
    startTransition(async () => {
      const result = await reassignArea({
        areaId: area.id,
        date,
        employeeIds: [...selected],
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.added + result.removed === 0
          ? "No changes."
          : `${area.name} updated.`,
      )
      setEditing(false)
      router.refresh()
    })
  }

  function openUp() {
    startTransition(async () => {
      const result = await unassignArea({ areaId: area.id, date })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`${area.name} is now open to all staff.`)
      setSelected(new Set())
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <Card
      className={cn("gap-3 border-l-4 py-4", flagged && "ring-1 ring-destructive/40")}
      style={{ borderLeftColor: accent ?? "var(--module-daily)" }}
    >
      <div className="flex items-start justify-between gap-3 px-5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2 text-base font-semibold leading-tight">
            {flagged ? (
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-destructive"
                aria-label="Assigned but not completed"
              />
            ) : null}
            {area.name}
          </span>
          <span className="text-sm text-muted-foreground">
            {assigned
              ? area.assignees
                  .map(
                    (a) =>
                      `${a.name}${
                        a.source !== "manual"
                          ? ` (${SOURCE_LABEL[a.source] ?? a.source})`
                          : ""
                      }`,
                  )
                  .join(", ")
              : "Open — any staff member can complete"}
          </span>
        </div>
        {area.done ? (
          <Badge className="shrink-0 gap-1 bg-primary/15 text-primary hover:bg-primary/15">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Done
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
            <Circle className="h-3 w-3" aria-hidden />
            Incomplete
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSelected(new Set(area.assignees.map((a) => a.employeeId)))
            setEditing((v) => !v)
          }}
          disabled={pending || !isOnline}
        >
          <UserRoundPlus className="h-4 w-4" aria-hidden />
          {assigned ? "Reassign" : "Assign"}
        </Button>
        {assigned ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openUp}
            disabled={pending || !isOnline}
            className="text-muted-foreground"
          >
            Open up
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3 px-5">
          <ul className="max-h-56 overflow-y-auto rounded-lg border bg-background">
            {employees.map((e) => {
              const checked = selected.has(e.id)
              return (
                <li key={e.id} className="border-b last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(ev) =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (ev.target.checked) next.add(e.id)
                          else next.delete(e.id)
                          return next
                        })
                      }
                      className="size-5 shrink-0 cursor-pointer rounded border-input accent-primary"
                    />
                    <span className="text-sm font-medium">{e.name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save assignees"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

export function AssignmentBoardView({ board }: { board: AssignmentBoard }) {
  const { isOnline } = useSyncQueue()
  const inWarningWindow =
    board.minutesUntilDayClose !== null &&
    board.minutesUntilDayClose <= board.prelockWarningMinutes

  const flaggedIds = useMemo(
    () =>
      new Set(
        inWarningWindow
          ? board.areas
              .filter((a) => a.assignees.length > 0 && !a.done)
              .map((a) => a.id)
          : [],
      ),
    [board.areas, inWarningWindow],
  )

  // Inside the warning window, incomplete assigned areas surface to the top.
  const areas = useMemo(() => {
    if (flaggedIds.size === 0) return board.areas
    return [...board.areas].sort(
      (a, b) => Number(flaggedIds.has(b.id)) - Number(flaggedIds.has(a.id)),
    )
  }, [board.areas, flaggedIds])

  if (!board.routingEnabled) {
    return (
      <Card className="py-6">
        <p className="px-6 text-sm text-muted-foreground">
          Assignment routing is turned off for this facility, so every area is
          open to all staff. An admin can enable it under Admin → Daily Reports
          → Assignments.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {!isOnline ? (
        <Callout tone="warning">
          You&apos;re offline — assignment changes need a connection and are
          disabled. They are never queued, so nothing will apply unexpectedly
          later.
        </Callout>
      ) : null}

      {inWarningWindow && flaggedIds.size > 0 ? (
        <Callout tone="destructive" icon={<AlertTriangle />}>
          <span className="font-semibold">Day closes soon.</span>{" "}
          {flaggedIds.size === 1
            ? "1 assigned area is"
            : `${flaggedIds.size} assigned areas are`}{" "}
          not completed with under {board.minutesUntilDayClose} minutes left in
          the day. Reassign or follow up — the report still closes at end of
          day either way.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-3">
        {areas.map((area) => (
          <AreaRow
            key={area.id}
            area={area}
            date={board.date}
            employees={board.employees}
            flagged={flaggedIds.has(area.id)}
            isOnline={isOnline}
          />
        ))}
      </div>
    </div>
  )
}
