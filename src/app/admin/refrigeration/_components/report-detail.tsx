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

import { addRefrigerationFollowupNote } from "../actions"
import type { ActionState, ReportDetailData, ReportValueRow } from "../types"

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

function formatValue(v: ReportValueRow): string {
  switch (v.field_type_snapshot) {
    case "numeric":
      return v.value_numeric === null
        ? "—"
        : `${v.value_numeric}${v.unit_snapshot ? ` ${v.unit_snapshot}` : ""}`
    case "boolean":
      return v.value_boolean === null
        ? "—"
        : v.value_boolean
          ? "Yes"
          : "No"
    case "select":
    case "text":
    default:
      return v.value_text ?? "—"
  }
}

export function ReportDetail({ detail, backHref }: Props) {
  const { report, employee, values, notes } = detail
  const [noteState, noteAction, notePending] = useActionState(
    addRefrigerationFollowupNote,
    NOTE_INITIAL,
  )

  useEffect(() => {
    if (noteState.ok === false) toast.error(noteState.error)
    if (noteState.ok === true) toast.success(noteState.message ?? "Note added.")
  }, [noteState])

  const oorCount = values.filter((v) => v.is_out_of_range).length

  // Group values by equipment_name_snapshot (null bucket = section-level).
  const groups = new Map<string, ReportValueRow[]>()
  for (const v of values) {
    const key = v.equipment_name_snapshot ?? "__section__"
    const arr = groups.get(key) ?? []
    arr.push(v)
    groups.set(key, arr)
  }
  const groupKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "__section__") return -1
    if (b === "__section__") return 1
    return a.localeCompare(b)
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>Refrigeration report</CardTitle>
              {oorCount > 0 && (
                <Badge variant="error">{oorCount} out of range</Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Submitted {fmt(report.submitted_at)} by{" "}
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
          <h3 className="text-sm font-semibold">Recorded values</h3>
          {values.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No values recorded on this report.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groupKeys.map((gk) => {
                const rows = groups.get(gk) ?? []
                const heading =
                  gk === "__section__" ? "Section-level" : gk
                return (
                  <div key={gk} className="flex flex-col gap-1">
                    <h4 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                      {heading}
                    </h4>
                    <div className="overflow-auto rounded-md border">
                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-muted/60">
                          <tr>
                            <th className="border-b px-3 py-2 text-left font-medium">
                              Field
                            </th>
                            <th className="border-b px-3 py-2 text-left font-medium">
                              Value
                            </th>
                            <th className="border-b px-3 py-2 text-left font-medium">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((v) => (
                            <tr key={v.id} className="hover:bg-muted/30">
                              <td className="border-b px-3 py-2 align-middle">
                                {v.label_snapshot}
                                {v.unit_snapshot && (
                                  <span className="text-muted-foreground text-xs">
                                    {" "}
                                    ({v.unit_snapshot})
                                  </span>
                                )}
                              </td>
                              <td
                                className={cn(
                                  "border-b px-3 py-2 align-middle",
                                  v.is_out_of_range && "font-medium",
                                )}
                              >
                                {formatValue(v)}
                              </td>
                              <td className="border-b px-3 py-2 align-middle">
                                {v.is_out_of_range ? (
                                  <Badge variant="error">Out of range</Badge>
                                ) : (
                                  <span className="text-muted-foreground text-xs">
                                    OK
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
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
            <label htmlFor="rfn-body" className="text-sm font-medium">
              Add follow-up note
            </label>
            <Textarea
              id="rfn-body"
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
