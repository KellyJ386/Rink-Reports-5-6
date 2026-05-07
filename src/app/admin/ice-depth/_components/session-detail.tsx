"use client"

import Link from "next/link"
import { useActionState, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { addIceDepthFollowupNote } from "../actions"
import type {
  ActionState,
  MeasurementRow,
  ReadingSeverity,
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

const VIEW_HEIGHT = 600

export function SessionDetail({ detail, backHref }: Props) {
  const { session, layout, points, employee, measurements, notes, settings } =
    detail
  const [heatmap, setHeatmap] = useState(false)

  const [noteState, noteAction, notePending] = useActionState(
    addIceDepthFollowupNote,
    NOTE_INITIAL,
  )
  useEffect(() => {
    if (noteState.ok === false) toast.error(noteState.error)
    if (noteState.ok === true) toast.success(noteState.message ?? "Note added.")
  }, [noteState])

  const aspect = layout?.diagram_aspect_ratio ?? 0.425
  const w = Math.max(80, Math.round(VIEW_HEIGHT * aspect))
  const h = VIEW_HEIGHT

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
                  <span className="bg-destructive/15 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
                    {session.low_count} low
                  </span>
                )}
                {session.has_high_reading && (
                  <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:text-yellow-200">
                    {session.high_count} high
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={heatmap}
                  onChange={(e) => setHeatmap(e.target.checked)}
                  className="border-input size-4 rounded border"
                />
                Heat-map view
              </label>
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col items-center gap-2">
              <div
                className="bg-background relative w-full max-w-md rounded-md border p-2"
                style={{ aspectRatio: `${aspect}` }}
              >
                <svg
                  viewBox={`0 0 ${w} ${h}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="h-full w-full select-none"
                >
                  {/* Optional heatmap background — discrete colored tile per
                      measurement, blurred via filter. */}
                  {heatmap && (
                    <>
                      <defs>
                        <filter
                          id="hm-blur"
                          x="-20%"
                          y="-20%"
                          width="140%"
                          height="140%"
                        >
                          <feGaussianBlur stdDeviation="22" />
                        </filter>
                      </defs>
                      <g filter="url(#hm-blur)" opacity={0.55}>
                        {measurements.map((m) => (
                          <circle
                            key={`hm-${m.id}`}
                            cx={m.x_snapshot * w}
                            cy={m.y_snapshot * h}
                            r={Math.min(w, h) * 0.18}
                            fill={severityColor(m.severity, settings)}
                          />
                        ))}
                      </g>
                    </>
                  )}

                  <rect
                    x={2}
                    y={2}
                    width={w - 4}
                    height={h - 4}
                    rx={Math.min(w, h) * 0.18}
                    ry={Math.min(w, h) * 0.18}
                    fill={heatmap ? "transparent" : "#e0f2fe"}
                    stroke="#0c4a6e"
                    strokeWidth={2}
                  />
                  <line
                    x1={2}
                    y1={h / 2}
                    x2={w - 2}
                    y2={h / 2}
                    stroke="#dc2626"
                    strokeWidth={2}
                    opacity={heatmap ? 0.4 : 1}
                  />
                  <line
                    x1={2}
                    y1={h * 0.32}
                    x2={w - 2}
                    y2={h * 0.32}
                    stroke="#2563eb"
                    strokeWidth={2}
                    opacity={heatmap ? 0.4 : 1}
                  />
                  <line
                    x1={2}
                    y1={h * 0.68}
                    x2={w - 2}
                    y2={h * 0.68}
                    stroke="#2563eb"
                    strokeWidth={2}
                    opacity={heatmap ? 0.4 : 1}
                  />

                  {/* Layout points (ghost outline if no measurement on it) */}
                  {points.map((p) => {
                    const m = byPointId.get(p.id)
                    const cx = (m ? m.x_snapshot : p.x_position) * w
                    const cy = (m ? m.y_snapshot : p.y_position) * h
                    const fill = m
                      ? severityColor(m.severity, settings)
                      : "#cbd5e1"
                    return (
                      <g key={p.id}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={14}
                          fill={fill}
                          stroke="#0f172a"
                          strokeWidth={1.5}
                          opacity={m ? 1 : 0.5}
                        />
                        <text
                          x={cx}
                          y={cy + 4}
                          textAnchor="middle"
                          fontSize={10}
                          fontWeight={700}
                          fill="#ffffff"
                          pointerEvents="none"
                        >
                          {m?.point_number_snapshot ?? p.point_number}
                        </text>
                        {m && (
                          <text
                            x={cx + 18}
                            y={cy + 4}
                            fontSize={11}
                            fontWeight={600}
                            fill="#0f172a"
                            pointerEvents="none"
                          >
                            {m.depth_value}
                          </text>
                        )}
                      </g>
                    )
                  })}

                  {/* Orphan measurements (point was deleted) */}
                  {orphanMeasurements.map((m) => (
                    <g key={`om-${m.id}`}>
                      <circle
                        cx={m.x_snapshot * w}
                        cy={m.y_snapshot * h}
                        r={14}
                        fill={severityColor(m.severity, settings)}
                        stroke="#9ca3af"
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                      />
                      <text
                        x={m.x_snapshot * w}
                        y={m.y_snapshot * h + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={700}
                        fill="#ffffff"
                      >
                        {m.point_number_snapshot}
                      </text>
                      <text
                        x={m.x_snapshot * w + 18}
                        y={m.y_snapshot * h + 4}
                        fontSize={11}
                        fontWeight={600}
                        fill="#0f172a"
                      >
                        {m.depth_value}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
              <p className="text-muted-foreground text-xs">
                Colors come from session-snapshot severities. Changing the
                facility settings does not reclassify history.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Measurements ({measurements.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {measurements.length === 0 ? (
                    <p className="text-muted-foreground p-3 text-sm">
                      No measurements on this session.
                    </p>
                  ) : (
                    <div className="max-h-[60vh] overflow-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-muted/60 sticky top-0">
                          <tr>
                            <th className="border-b px-3 py-2 text-left font-medium">
                              #
                            </th>
                            <th className="border-b px-3 py-2 text-left font-medium">
                              Label
                            </th>
                            <th className="border-b px-3 py-2 text-right font-medium">
                              Depth
                            </th>
                            <th className="border-b px-3 py-2 text-left font-medium">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...measurements]
                            .sort(
                              (a, b) =>
                                a.point_number_snapshot -
                                b.point_number_snapshot,
                            )
                            .map((m) => (
                              <tr key={m.id} className="hover:bg-muted/30">
                                <td className="border-b px-3 py-1.5 align-middle font-mono text-xs">
                                  {m.point_number_snapshot}
                                </td>
                                <td className="border-b px-3 py-1.5 align-middle">
                                  {m.label_snapshot ?? (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                                <td className="border-b px-3 py-1.5 text-right align-middle font-mono">
                                  {m.depth_value}
                                </td>
                                <td className="border-b px-3 py-1.5 align-middle">
                                  <SeverityBadge
                                    severity={m.severity as ReadingSeverity}
                                  />
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
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

function SeverityBadge({ severity }: { severity: ReadingSeverity }) {
  const cls =
    severity === "low"
      ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
      : severity === "high"
        ? "bg-destructive/15 text-destructive"
        : "bg-muted text-muted-foreground"
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium uppercase",
        cls,
      )}
    >
      {severity}
    </span>
  )
}
