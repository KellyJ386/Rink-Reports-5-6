"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatDateOnly, formatDateTime } from "../../_lib/datetime"
import {
  cancelTimeOffRequest,
  decideTimeOffRequest,
  type TimeOffConflict,
  type TimeOffConflictResolution,
} from "../../_lib/governance-actions"

type Row = {
  id: string
  employee_id: string
  starts_at: string
  ends_at: string
  reason: string | null
  status: string
  created_at: string
  decided_at: string | null
  decision_note: string | null
  employee: {
    id: string
    first_name: string
    last_name: string
    employee_code: string | null
  } | null
}

type Props = { rows: Row[] }

function statusVariant(status: string): BadgeProps["variant"] {
  if (status === "approved") return "success"
  if (status === "pending") return "warning"
  if (status === "denied") return "error"
  return "secondary"
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{status}</Badge>
}

function shortReason(s: string | null): string {
  if (!s) return ""
  const t = s.trim()
  return t.length > 80 ? `${t.slice(0, 77)}…` : t
}

export function TimeOffList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
        No time-off requests in this view.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <TimeOffRow key={row.id} row={row} />
      ))}
    </div>
  )
}

function TimeOffRow({ row }: { row: Row }) {
  const [openDecision, setOpenDecision] = useState<
    null | "approved" | "denied"
  >(null)
  const [note, setNote] = useState("")
  const [conflicts, setConflicts] = useState<TimeOffConflict[] | null>(null)
  const [pending, startTransition] = useTransition()

  const employeeName = row.employee
    ? `${row.employee.first_name} ${row.employee.last_name}`
    : "Unknown employee"
  const code = row.employee?.employee_code ? ` (${row.employee.employee_code})` : ""

  function submitDecision(
    decision: "approved" | "denied",
    onConflict?: TimeOffConflictResolution
  ) {
    startTransition(async () => {
      const r = await decideTimeOffRequest(
        row.id,
        decision,
        note.trim() || undefined,
        onConflict ? { onConflict } : undefined
      )
      if (r.ok === true) {
        toast.success(r.message ?? "Updated.")
        setOpenDecision(null)
        setNote("")
        setConflicts(null)
      } else if (r.ok === false) {
        if (r.conflicts && r.conflicts.length > 0) {
          setConflicts(r.conflicts)
        } else {
          toast.error(r.error)
        }
      }
    })
  }

  function submitCancel() {
    startTransition(async () => {
      const r = await cancelTimeOffRequest(row.id)
      if (r.ok === true) toast.success(r.message ?? "Cancelled.")
      else if (r.ok === false) toast.error(r.error)
    })
  }

  return (
    <div className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">
            {employeeName}
            {code}
          </div>
          <div className="text-muted-foreground text-xs">
            {formatDateOnly(row.starts_at)} – {formatDateOnly(row.ends_at)}
          </div>
          {row.reason ? (
            <div className="text-sm">{shortReason(row.reason)}</div>
          ) : null}
          <div className="text-muted-foreground text-xs">
            Requested {formatDateTime(row.created_at)}
            {row.decided_at
              ? ` · Decided ${formatDateTime(row.decided_at)}`
              : ""}
          </div>
          {row.decision_note ? (
            <div className="text-muted-foreground text-xs italic">
              Note: {row.decision_note}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={row.status} />
          {row.status === "pending" ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setOpenDecision("approved")
                  setNote("")
                }}
                disabled={pending}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpenDecision("denied")
                  setNote("")
                }}
                disabled={pending}
              >
                Deny
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={submitCancel}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {openDecision !== null ? (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
          <label className="text-xs font-medium">
            Optional note ({openDecision === "approved" ? "approval" : "denial"})
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Visible to the requesting employee"
          />
          {conflicts && conflicts.length > 0 ? (
            <div className="border-warning/50 bg-warning/10 flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                Scheduled during this time off:
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {conflicts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <span>{formatDateTime(c.starts_at)}</span>
                    <span className="text-muted-foreground">
                      – {formatDateTime(c.ends_at)}
                    </span>
                    {c.role_label ? (
                      <span className="text-muted-foreground">
                        · {c.role_label}
                      </span>
                    ) : null}
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                Unassigning removes the employee from these shifts; published
                shifts return to the open-shift claim queue and the employee is
                notified.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => submitDecision("approved", "unassign")}
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Approve & unassign shifts"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => submitDecision("approved", "approve_anyway")}
                  disabled={pending}
                >
                  Approve anyway
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpenDecision(null)
                    setNote("")
                    setConflicts(null)
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => submitDecision(openDecision)}
                disabled={pending}
              >
                {pending ? "Saving…" : `Confirm ${openDecision}`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpenDecision(null)
                  setNote("")
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
