"use client"

import Link from "next/link"
import { useActionState, useEffect, useMemo } from "react"
import { toast } from "sonner"

import { USARink, rinkCoords, type RinkPointSpec } from "@/components/ice-depth/usa-rink"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

import { addIceDepthFollowupNote } from "../actions"
import type {
  ActionState,
  MeasurementRow,
  SessionDetailData,
  SettingsRow,
} from "../types"

const NOTE_INITIAL: ActionState = { ok: null }

type Props = {
  detail: SessionDetailData
  backHref: string
}

function fmt(ts: string | null): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function severityColor(
  severity: string,
  settings: SettingsRow | null,
): string {
  const low = settings?.low_color ?? "#1d4ed8"
  const ok = settings?.ok_color ?? "#16a34a"
  const high = settings?.high_color ?? "#dc2626"
  if (severity === "low") return low
  if (severity === "high") return high
  return ok
}

export function SessionDetail({ detail, backHref }: Props) {
  const { session, layout, points, employee, measurements, notes, settings } =
    detail

  const [noteState, noteAction, notePending] = useActionState(
    addIceDepthFollowupNote,
    NOTE_INITIAL,
  )
  useEffect(() => {
    if (noteState.ok === false) toast.error(noteState.error)
    if (noteState.ok === true) toast.success(noteState.message ?? "Note added.")
  }, [noteState])

  // Index measurements by point_id (or by point_number_snapshot when point was
  // deleted). We render measurements at their snapshot coordinates so historic
  // sessions continue to render even after layout edits.
  const byPointId = useMemo(() => {
    const m = new Map<string, MeasurementRow>()
    for (const r of measurements) {
      if (r.point_id) m.set(r.point_id, r)
    }
    return m
  }, [measurements])

  const orphanMeasurements = useMemo(
    () => measurements.filter((m) => !m.point_id),
    [measurements],
  )

  // Build RinkPointSpec array for USARink component
  const rinkPoints = useMemo((): RinkPointSpec[] => {
    const result: RinkPointSpec[] = []

    // Layout points (may or may not have measurements)
    for (const p of points) {
      const m = byPointId.get(p.id)
      const xPos = m ? m.x_snapshot : p.x_position
      const yPos = m ? m.y_snapshot : p.y_position
      const { cx, cy } = rinkCoords(xPos, yPos)
      const color = m ? severityColor(m.severity, settings) : undefined
      result.push({
        id: p.id,
        pointNumber: m?.point_number_snapshot ?? p.point_number,
        cx,
        cy,
        state: m ? "done" : "inactive",
        doneColor: color,
        depthValue: m ? m.depth_value : null,
      })
    }

    // Orphaned measurements (point was deleted)
    for (const m of orphanMeasurements) {
      const { cx, cy } = rinkCoords(m.x_snapshot, m.y_snapshot)
      result.push({
        id: `orphan-${m.id}`,
        pointNumber: m.point_number_snapshot,
        cx,
        cy,
        state: "done",
        doneColor: severityColor(m.severity, settings),
        depthValue: m.depth_value,
      })
    }

    return result
  }, [points, byPointId, orphanMeasurements, settings])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>← Back to history</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>
                {layout?.name ?? "Unknown layout"} —{" "}
                {fmt(session.submitted_at)}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                Submitted by{" "}
                {employee
                  ? `${employee.first_name} ${employee.last_name}`
                  : "Unknown"}{" "}
                · Unit {session.measurement_unit_snapshot} · Low{" "}
                {session.low_threshold_snapshot} · High{" "}
                {session.high_threshold_snapshot}
              </p>
              <div className="flex gap-2">
                {session.has_low_reading && (
                  <Badge variant="error">{session.low_count} low</Badge>
                )}
                {session.has_high_reading && (
                  <Badge variant="warning">{session.high_count} high</Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {session.notes && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Submitter notes</h3>
              <p className="bg-muted/30 rounded-md border p-3 text-sm whitespace-pre-wrap">
                {session.notes}
              </p>
            </section>
          )}

          <div className="flex flex-col items-center gap-2">
            <div className="w-full max-w-xs" style={{ aspectRatio: "380/740" }}>
              <USARink
                points={rinkPoints}
                showValues
                className="rounded-xl border"
                logoUrl={detail.layout?.logo_url ?? null}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Colors come from session-snapshot severities. Changing the
              facility settings does not reclassify history.
            </p>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              Follow-up notes ({notes.length})
            </h3>
            <p className="text-muted-foreground text-xs">
              Notes are append-only. The original session is immutable.
            </p>
            {notes.length === 0 ? (
              <p className="text-muted-foreground text-sm">No notes yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">
                        {n.author
                          ? `${n.author.first_name} ${n.author.last_name}`
                          : "Admin"}
                        {n.is_admin_note && (
                          <span className="text-muted-foreground ml-2 font-normal">
                            (admin)
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground">
                        {fmt(n.created_at)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}

            <form
              action={noteAction}
              className="bg-background mt-2 flex flex-col gap-2 rounded-md border p-3"
              key={noteState.ok === true ? `note-${notes.length}` : "note-form"}
            >
              <input type="hidden" name="session_id" value={session.id} />
              <label htmlFor="idfn-body" className="text-sm font-medium">
                Add follow-up note
              </label>
              <Textarea
                id="idfn-body"
                name="body"
                required
                rows={3}
                placeholder="Visible to admins on this session."
              />
              {noteState.ok === false && (
                <p role="alert" className="text-destructive text-sm">
                  {noteState.error}
                </p>
              )}
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={notePending}>
                  {notePending ? "Adding…" : "Add note"}
                </Button>
              </div>
            </form>
          </section>
        </CardContent>
      </Card>
    </div>
  )
}

