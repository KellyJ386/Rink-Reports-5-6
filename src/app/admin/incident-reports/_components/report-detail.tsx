"use client"

import Link from "next/link"
import { useActionState, useEffect, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { LocalDateTime } from "@/components/app/local-datetime"

import { addFollowupNote, setReportStatus } from "../actions"
import type { ActionState, IncidentReportDetail, IncidentStatus } from "../types"
import { STATUSES, isIncidentStatus } from "../types"

import { StatusBadge } from "./status-badge"

const NOTE_INITIAL: ActionState = { ok: null }

type Props = {
  detail: IncidentReportDetail
  backHref: string
}

export function ReportDetail({ detail, backHref }: Props) {
  const { report, type, severity, activity, spaces, witnesses, employee, notes, changeLog } =
    detail
  const [noteState, noteAction, notePending] = useActionState(
    addFollowupNote,
    NOTE_INITIAL,
  )
  const [statusPending, startStatusTransition] = useTransition()

  useEffect(() => {
    if (noteState && "ok" in noteState && noteState.ok === false) {
      toast.error(noteState.error)
    }
  }, [noteState])

  function onChangeStatus(next: string) {
    if (!isIncidentStatus(next)) return
    if (next === report.status) return
    startStatusTransition(async () => {
      const r = await setReportStatus(report.id, next as IncidentStatus)
      if (!r.ok) toast.error(r.error)
      else toast.success(`Status set to ${next}.`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>Incident report</CardTitle>
              <StatusBadge status={report.status} />
            </div>
            <p className="text-muted-foreground text-sm">
              Submitted <LocalDateTime iso={report.submitted_at} /> by{" "}
              {employee
                ? `${employee.first_name} ${employee.last_name}`
                : (report.reporter_name ?? "Unknown")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={backHref}>Back to list</Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Read-only original fields. NEVER expose edit controls for these. */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Original report</h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type">
              {type ? (
                <span className="inline-flex items-center gap-1.5">
                  {type.color && (
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: type.color }}
                    />
                  )}
                  {type.name}
                </span>
              ) : (
                "—"
              )}
            </Field>
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
            <Field label="Activity">
              {activity ? (
                <span className="inline-flex items-center gap-1.5">
                  {activity.color && (
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: activity.color }}
                    />
                  )}
                  {activity.display_name}
                </span>
              ) : report.activity_other ? (
                <span>
                  {report.activity_other}{" "}
                  <span className="text-muted-foreground text-xs">(other)</span>
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Occurred at">
              <LocalDateTime iso={report.occurred_at} />
            </Field>
            <Field label="Reporter name">{report.reporter_name}</Field>
            <Field label="Reporter phone">
              {report.reporter_phone || "—"}
            </Field>
            <Field label="Ambulance called">
              <BoolBadge value={report.ambulance_flag} alertWhenTrue />
            </Field>
            <Field label="People involved">
              {report.persons_involved === null
                ? "—"
                : report.persons_involved}
            </Field>
            <Field label="Follow-up required">
              <BoolBadge value={report.follow_up_required} />
            </Field>
            {report.location && (
              <Field label="Location (legacy)">{report.location}</Field>
            )}
          </dl>

          <Field label="Facility spaces">
            {spaces.length === 0 && !report.location_other ? (
              "—"
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {spaces.map((s) => (
                  <span
                    key={s.id}
                    className="bg-muted inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  >
                    {s.name}
                  </span>
                ))}
                {report.location_other && (
                  <span className="bg-muted inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                    {report.location_other}
                    <span className="text-muted-foreground ml-1">(other)</span>
                  </span>
                )}
              </div>
            )}
          </Field>

          <Field label="Description">
            <p className="text-sm whitespace-pre-wrap">{report.description}</p>
          </Field>

          {report.immediate_actions && (
            <Field label="Immediate actions taken">
              <p className="text-sm whitespace-pre-wrap">
                {report.immediate_actions}
              </p>
            </Field>
          )}
        </section>

        {witnesses.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              Witnesses ({witnesses.length})
            </h3>
            <ul className="flex flex-col gap-2">
              {witnesses.map((w) => (
                <li
                  key={w.id}
                  className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3"
                >
                  <span className="text-sm font-medium">{w.name}</span>
                  <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                    {w.phone && <span>Phone: {w.phone}</span>}
                    {w.email && <span>Email: {w.email}</span>}
                  </div>
                  {w.statement && (
                    <p className="text-sm whitespace-pre-wrap">{w.statement}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Status timeline + transition controls */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Status</h3>
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="status-select"
              className="text-muted-foreground text-xs font-medium"
            >
              Change status
            </label>
            <Select
              value={report.status}
              onValueChange={(v) => onChangeStatus(v)}
              disabled={statusPending}
            >
              <SelectTrigger id="status-select" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {statusPending && (
              <span className="text-muted-foreground text-xs">Saving…</span>
            )}
          </div>
          <dl className="text-muted-foreground grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <TimestampPill label="Submitted" ts={report.submitted_at} />
            <TimestampPill label="Reviewed" ts={report.reviewed_at} />
            <TimestampPill label="Resolved" ts={report.resolved_at} />
            <TimestampPill label="Archived" ts={report.archived_at} />
          </dl>
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
                      <LocalDateTime iso={n.created_at} />
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
            <input type="hidden" name="incident_id" value={report.id} />
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
            {noteState &&
              "ok" in noteState &&
              noteState.ok === false && (
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

        {/* Append-only audit trail */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Change log ({changeLog.length})
          </h3>
          <p className="text-muted-foreground text-xs">
            Audit trail of edits to this report. Visible to admins only.
          </p>
          {changeLog.length === 0 ? (
            <p className="text-muted-foreground text-sm">No changes recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {changeLog.map((c) => (
                <li
                  key={c.id}
                  className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">{c.action}</span>
                    <span className="text-muted-foreground">
                      <LocalDateTime iso={c.created_at} />
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {c.author
                      ? `${c.author.first_name} ${c.author.last_name}`
                      : "System"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
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

function BoolBadge({
  value,
  alertWhenTrue = false,
}: {
  value: boolean
  alertWhenTrue?: boolean
}) {
  const tone = value
    ? alertWhenTrue
      ? "bg-destructive/15 text-destructive"
      : "bg-primary/15 text-primary"
    : "bg-muted text-muted-foreground"
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {value ? "Yes" : "No"}
    </span>
  )
}

function TimestampPill({
  label,
  ts,
}: {
  label: string
  ts: string | null
}) {
  return (
    <div className="bg-muted/40 flex flex-col gap-0.5 rounded-md border p-2">
      <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        {label}
      </span>
      <span className="text-foreground text-xs">
        <LocalDateTime iso={ts} />
      </span>
    </div>
  )
}
