"use client"

import Link from "next/link"
import { useActionState, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { BodyDiagram } from "@/components/staff/body-diagram/lazy"
import {
  EMPTY_BODY_SELECTIONS,
  isBodyPartKey,
  isBodySide,
  isLaterality,
  isPairedBodyPartKey,
  type BodySelections,
  type BodySide,
  type Laterality,
} from "@/components/staff/body-diagram/types"

import { addAccidentFollowupNote } from "../actions"
import type {
  AccidentChangeLogRow,
  AccidentReportDetail,
  ActionState,
  EmployeeLite,
} from "../types"

const NOTE_INITIAL: ActionState = { ok: null }

type Props = {
  detail: AccidentReportDetail
  backHref: string
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function buildBodySelections(
  bps: AccidentReportDetail["body_parts"],
): BodySelections {
  const out: BodySelections = {
    ...EMPTY_BODY_SELECTIONS,
    shoulders: { ...EMPTY_BODY_SELECTIONS.shoulders },
    arms: { ...EMPTY_BODY_SELECTIONS.arms },
    upper_arms: { ...EMPTY_BODY_SELECTIONS.upper_arms },
    lower_arms: { ...EMPTY_BODY_SELECTIONS.lower_arms },
    elbows: { ...EMPTY_BODY_SELECTIONS.elbows },
    wrists: { ...EMPTY_BODY_SELECTIONS.wrists },
    hands: { ...EMPTY_BODY_SELECTIONS.hands },
    fingers: { ...EMPTY_BODY_SELECTIONS.fingers },
    upper_legs: { ...EMPTY_BODY_SELECTIONS.upper_legs },
    knees: { ...EMPTY_BODY_SELECTIONS.knees },
    lower_legs: { ...EMPTY_BODY_SELECTIONS.lower_legs },
    ankles: { ...EMPTY_BODY_SELECTIONS.ankles },
    feet: { ...EMPTY_BODY_SELECTIONS.feet },
  }
  for (const b of bps) {
    const key = b.body_part?.key
    if (!key || !isBodyPartKey(key)) continue
    const side: BodySide = isBodySide(b.side) ? (b.side as BodySide) : "none"
    if (side === "none") continue
    const lat: Laterality | null =
      typeof b.laterality === "string" && isLaterality(b.laterality)
        ? b.laterality
        : null
    if (isPairedBodyPartKey(key)) {
      const paired = out[key]
      if (lat) {
        paired[lat] = side
      } else {
        // Legacy row (pre-migration 92): treat as both sides.
        paired.left = side
        paired.right = side
      }
    } else {
      // Midline region. The union-indexed assignment trips TypeScript because
      // it intersects every possible value type, so cast to write BodySide.
      ;(out as unknown as Record<string, BodySide>)[key] = side
    }
  }
  return out
}

export function ReportDetail({ detail, backHref }: Props) {
  const {
    report,
    injury_type,
    location,
    activity,
    medical_attention,
    severity,
    employee,
    body_parts,
    witnesses,
    notes,
    change_log,
  } = detail

  const [noteState, noteAction, notePending] = useActionState(
    addAccidentFollowupNote,
    NOTE_INITIAL,
  )

  useEffect(() => {
    if (noteState && "ok" in noteState) {
      if (noteState.ok === false) toast.error(noteState.error)
      else if (noteState.ok === true && noteState.message)
        toast.success(noteState.message)
    }
  }, [noteState])

  const selections = useMemo(
    () => buildBodySelections(body_parts),
    [body_parts],
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Accident report</CardTitle>
            <p className="text-muted-foreground text-sm">
              Submitted {fmt(report.submitted_at)} by{" "}
              {employee
                ? `${employee.first_name} ${employee.last_name}`
                : "Unknown"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={backHref}>Close</Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Read-only original fields. NEVER expose edit controls for these. */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Original report (read-only)</h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Injured person">
              {report.injured_person_name}
            </Field>
            <Field label="Contact">{report.injured_person_contact}</Field>
            <Field label="Age">
              {report.injured_person_age === null ||
              report.injured_person_age === undefined
                ? "—"
                : `${report.injured_person_age}`}
            </Field>
            <Field label="Occurred at">{fmt(report.occurred_at)}</Field>
            <Field label="Submitted at">{fmt(report.submitted_at)}</Field>
            <Field label="Severity">
              {severity ? (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={
                    severity.color
                      ? {
                          backgroundColor: `${severity.color}22`,
                          color: severity.color,
                        }
                      : undefined
                  }
                >
                  {severity.display_name}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Primary injury type">
              {injury_type?.display_name ?? "—"}
            </Field>
            <Field label="Location">{location?.display_name ?? "—"}</Field>
            <Field label="Activity">{activity?.display_name ?? "—"}</Field>
            <Field label="Medical attention">
              {medical_attention?.display_name ?? "—"}
            </Field>
            <Field label="Workers' Comp">
              {report.workers_comp ? (
                <Badge variant="warning">Yes</Badge>
              ) : (
                "No"
              )}
            </Field>
            <Field label="W/C acknowledged at">
              {fmt(report.workers_comp_acknowledged_at)}
            </Field>
          </dl>
          <Field label="Description">
            <p className="text-sm whitespace-pre-wrap">{report.description}</p>
          </Field>
        </section>

        {/* Body diagram (read-only) */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            Body parts ({body_parts.length})
          </h3>
          <BodyDiagram selections={selections} readOnly />
          {body_parts.some((b) => b.notes) && (
            <ul className="flex flex-col gap-1.5 text-sm">
              {body_parts
                .filter((b) => b.notes)
                .map((b) => {
                  const latPrefix =
                    b.laterality === "left"
                      ? "Left "
                      : b.laterality === "right"
                        ? "Right "
                        : ""
                  return (
                    <li
                      key={b.id}
                      className="bg-muted/30 rounded-md border p-2 text-xs"
                    >
                      <span className="font-medium">
                        {`${latPrefix}${b.body_part?.display_name ?? "—"}`}
                      </span>{" "}
                      <span className="text-muted-foreground">({b.side})</span>:{" "}
                      {b.notes}
                    </li>
                  )
                })}
            </ul>
          )}
        </section>

        {/* Witnesses */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Witnesses ({witnesses.length})
          </h3>
          {witnesses.length === 0 ? (
            <p className="text-muted-foreground text-sm">No witnesses recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {witnesses.map((w) => (
                <li
                  key={w.id}
                  className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{w.name}</span>
                    {w.contact ? (
                      <span className="text-muted-foreground text-xs">
                        {w.contact}
                      </span>
                    ) : null}
                  </div>
                  {w.statement ? (
                    <p className="text-sm whitespace-pre-wrap">{w.statement}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Append-only follow-up notes */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Follow-up notes ({notes.length})
          </h3>
          <p className="text-muted-foreground text-xs">
            Notes are append-only and cannot be edited or deleted.
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
            // Reset textarea after successful submit by remounting.
            key={
              noteState && "ok" in noteState && noteState.ok === true
                ? `note-${notes.length}`
                : "note-pending"
            }
          >
            <input type="hidden" name="accident_id" value={report.id} />
            <label htmlFor="note-body" className="text-sm font-medium">
              Add follow-up note
            </label>
            <Textarea
              id="note-body"
              name="body"
              required
              rows={3}
              placeholder="Visible to admins on this report."
            />
            {noteState && "ok" in noteState && noteState.ok === false && (
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

        {/* Change log */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Change log ({change_log.length})
          </h3>
          {change_log.length === 0 ? (
            <p className="text-muted-foreground text-sm">No changes logged.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {change_log.map((entry) => (
                <ChangeLogItem key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function ChangeLogItem({
  entry,
}: {
  entry: AccidentChangeLogRow & { actor: EmployeeLite | null }
}) {
  const [open, setOpen] = useState(false)
  const hasDiff = entry.before !== null || entry.after !== null
  return (
    <li className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            {entry.action}
          </Badge>
          <span className="font-medium">
            {entry.actor
              ? `${entry.actor.first_name} ${entry.actor.last_name}`
              : "System"}
          </span>
        </span>
        <span className="text-muted-foreground">{fmt(entry.created_at)}</span>
      </div>
      {hasDiff && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-primary text-xs font-medium hover:underline"
          >
            {open ? "Hide" : "Show"} before/after
          </button>
          {open && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <pre className="bg-background overflow-auto rounded-md border p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                  Before
                </span>
                {entry.before
                  ? JSON.stringify(entry.before, null, 2)
                  : "(none)"}
              </pre>
              <pre className="bg-background overflow-auto rounded-md border p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                  After
                </span>
                {entry.after ? JSON.stringify(entry.after, null, 2) : "(none)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}
