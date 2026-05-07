"use client"

import Link from "next/link"
import { useActionState, useEffect } from "react"
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

import { addIceOperationsFollowupNote } from "../actions"
import type {
  ActionState,
  CircleCheckResultRow,
  SubmissionDetailData,
  TemperatureUnit,
} from "../types"
import {
  formatTemp,
  operationLabel,
  readBladeChangePayload,
  readEdgingPayload,
  readIceMakePayload,
} from "../types"

const NOTE_INITIAL: ActionState = { ok: null }

type Props = {
  detail: SubmissionDetailData
  backHref: string
  tempUnit: TemperatureUnit
}

function fmt(ts: string | null): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function fmtTime(ts: string | null): string {
  if (!ts) return "—"
  // Accept either HH:MM, full timestamps, or ISO strings.
  const dateLike = /^\d{4}-/.test(ts)
  if (dateLike) {
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return ts
    }
  }
  return ts
}

export function SubmissionDetail({ detail, backHref, tempUnit }: Props) {
  const { submission, rink, equipment, employee, results, notes } = detail
  const [noteState, noteAction, notePending] = useActionState(
    addIceOperationsFollowupNote,
    NOTE_INITIAL,
  )

  useEffect(() => {
    if (noteState.ok === false) toast.error(noteState.error)
    if (noteState.ok === true) toast.success(noteState.message ?? "Note added.")
  }, [noteState])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{operationLabel(submission.operation_type)}</CardTitle>
              {submission.has_failed_check && (
                <span className="bg-destructive/15 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
                  {submission.failed_count} failed
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {fmt(submission.occurred_at)} ·{" "}
              {rink ? rink.name : "No rink"} ·{" "}
              {equipment ? equipment.name : "No equipment"} ·{" "}
              {employee
                ? `${employee.first_name} ${employee.last_name}`
                : "Unknown employee"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>Back to list</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <PayloadSection detail={detail} tempUnit={tempUnit} />

        {submission.notes && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Submitter notes</h3>
            <p className="bg-muted/30 rounded-md border p-3 text-sm whitespace-pre-wrap">
              {submission.notes}
            </p>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Follow-up notes ({notes.length})
          </h3>
          <p className="text-muted-foreground text-xs">
            Notes are append-only and cannot be edited or deleted. The original
            report is immutable.
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
            <input type="hidden" name="submission_id" value={submission.id} />
            <label htmlFor="iofn-body" className="text-sm font-medium">
              Add follow-up note
            </label>
            <Textarea
              id="iofn-body"
              name="body"
              required
              rows={3}
              placeholder="Visible to admins on this submission."
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

        {/* Results last for circle_check */}
        {submission.operation_type === "circle_check" && (
          <CircleCheckResultsSection results={results} />
        )}
      </CardContent>
    </Card>
  )
}

function GridRow({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm">{value ?? "—"}</span>
    </div>
  )
}

function PayloadSection({
  detail,
  tempUnit,
}: {
  detail: SubmissionDetailData
  tempUnit: TemperatureUnit
}) {
  const { submission, replacedByEmployee } = detail

  switch (submission.operation_type) {
    case "ice_make": {
      const p = readIceMakePayload(submission.payload)
      return (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Ice make</h3>
          <div className="grid grid-cols-2 gap-4 rounded-md border p-3 sm:grid-cols-3">
            <GridRow
              label="Water temp"
              value={formatTemp(p.water_temp_c, tempUnit)}
            />
            <GridRow
              label="Ice temp"
              value={formatTemp(p.ice_temp_c, tempUnit)}
            />
            <GridRow label="Time in" value={fmtTime(p.time_in)} />
            <GridRow label="Time out" value={fmtTime(p.time_out)} />
            <GridRow
              label="Water used (gal)"
              value={p.water_used_gal !== null ? String(p.water_used_gal) : null}
            />
            <GridRow
              label="Surface passes"
              value={
                p.surface_pass_count !== null
                  ? String(p.surface_pass_count)
                  : null
              }
            />
          </div>
        </section>
      )
    }
    case "edging": {
      const p = readEdgingPayload(submission.payload)
      return (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Edging</h3>
          <div className="grid grid-cols-2 gap-4 rounded-md border p-3">
            <GridRow
              label="Hours run"
              value={p.hours_run !== null ? String(p.hours_run) : null}
            />
          </div>
        </section>
      )
    }
    case "blade_change": {
      const p = readBladeChangePayload(submission.payload)
      return (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Blade change</h3>
          <div className="grid grid-cols-2 gap-4 rounded-md border p-3 sm:grid-cols-3">
            <GridRow label="Blade serial" value={p.blade_serial} />
            <GridRow
              label="Hours at change"
              value={
                p.hours_at_change !== null ? String(p.hours_at_change) : null
              }
            />
            <GridRow
              label="Replaced by"
              value={
                replacedByEmployee
                  ? `${replacedByEmployee.first_name} ${replacedByEmployee.last_name}`
                  : null
              }
            />
          </div>
        </section>
      )
    }
    case "circle_check":
      return null
    default:
      return null
  }
}

function CircleCheckResultsSection({
  results,
}: {
  results: CircleCheckResultRow[]
}) {
  if (results.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Circle check results</h3>
        <p className="text-muted-foreground text-sm">
          No checklist items recorded on this submission.
        </p>
      </section>
    )
  }
  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">
          Circle check results ({results.length})
        </h3>
        <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs font-medium">
          {passed} passed
        </span>
        {failed > 0 && (
          <span className="bg-destructive/15 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
            {failed} failed
          </span>
        )}
      </div>
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">Item</th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Status
              </th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Failed notes
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="border-b px-3 py-2 align-middle">
                  {r.label_snapshot}
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      r.passed
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {r.passed ? "Passed" : "Failed"}
                  </span>
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  {r.failed_notes ? (
                    <span className="whitespace-pre-wrap">{r.failed_notes}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
