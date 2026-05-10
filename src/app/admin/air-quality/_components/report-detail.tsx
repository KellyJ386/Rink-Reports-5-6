"use client"

import Link from "next/link"
import { useActionState, useEffect } from "react"
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
import { cn } from "@/lib/utils"

import { addAirQualityFollowupNote } from "../actions"
import type {
  ActionState,
  ReadingRow,
  ReportDetailData,
  Severity,
} from "../types"

const NOTE_INITIAL: ActionState = { ok: null }

type Props = {
  detail: ReportDetailData
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

function severityBadgeVariant(sev: Severity | null): "destructive" | "warning" {
  if (sev === "critical") return "destructive"
  return "warning"
}

function fmtRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  if (min === null) return `≤ ${max}`
  if (max === null) return `≥ ${min}`
  return `${min} – ${max}`
}

function ReadingValue({ reading }: { reading: ReadingRow }) {
  const compliance = fmtRange(
    reading.compliance_min_at_submit,
    reading.compliance_max_at_submit,
  )
  const sev = reading.severity_at_submit as Severity | null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "font-medium",
            reading.is_exceedance && "text-destructive",
          )}
        >
          {reading.value_numeric}
        </span>
        <span className="text-muted-foreground text-xs">
          {reading.unit_snapshot}
        </span>
        {reading.is_exceedance && (
          <Badge
            variant={severityBadgeVariant(sev)}
            className="uppercase"
          >
            Exceedance{sev ? ` · ${sev}` : ""}
          </Badge>
        )}
      </div>
      {compliance && (
        <span className="text-muted-foreground text-xs">
          Compliance: {compliance} {reading.unit_snapshot}
        </span>
      )}
    </div>
  )
}

export function ReportDetail({ detail, backHref }: Props) {
  const { report, location, equipment, employee, readings, notes } = detail
  const [noteState, noteAction, notePending] = useActionState(
    addAirQualityFollowupNote,
    NOTE_INITIAL,
  )

  useEffect(() => {
    if (noteState.ok === false) toast.error(noteState.error)
    if (noteState.ok === true)
      toast.success(noteState.message ?? "Note added.")
  }, [noteState])

  const sev = (report.max_severity as Severity | null) ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>Air quality report</CardTitle>
              {report.has_exceedance && (
                <Badge
                  variant={severityBadgeVariant(sev)}
                  className="uppercase"
                >
                  Exceedance{sev ? ` · ${sev}` : ""}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {location?.name ?? "Unknown location"}
              {equipment ? ` · ${equipment.name}` : ""} · submitted{" "}
              {fmt(report.submitted_at)} by{" "}
              {employee
                ? `${employee.first_name} ${employee.last_name}`
                : "Unknown"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>Back to list</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {report.notes && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Submitter notes</h3>
            <p className="bg-muted/30 rounded-md border p-3 text-sm whitespace-pre-wrap">
              {report.notes}
            </p>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            Recorded readings ({readings.length})
          </h3>
          {readings.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No readings recorded on this report.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="border-b px-3 py-2 text-left font-medium">
                      Reading
                    </th>
                    <th className="border-b px-3 py-2 text-left font-medium">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="border-b px-3 py-2 align-top">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {r.label_snapshot}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {r.key_snapshot}
                          </span>
                        </div>
                      </td>
                      <td className="border-b px-3 py-2 align-top">
                        <ReadingValue reading={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
            <input type="hidden" name="report_id" value={report.id} />
            <label htmlFor="aqfn-body" className="text-sm font-medium">
              Add follow-up note
            </label>
            <Textarea
              id="aqfn-body"
              name="body"
              required
              rows={3}
              placeholder="Visible to admins on this report."
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
  )
}
