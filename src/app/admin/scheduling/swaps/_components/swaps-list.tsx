"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  formatDateTime,
  formatTimeRange,
  formatDateOnly,
} from "../../_lib/datetime"
import {
  approveSwap,
  assignSwapTarget,
  cancelSwap,
  denySwap,
} from "../../_lib/governance-actions"

type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
  employee_code: string | null
}

type ShiftLite = {
  id: string
  starts_at: string
  ends_at: string
}

export type SwapRow = {
  id: string
  status: string
  created_at: string
  decision_note: string | null
  decided_at: string | null
  approved_at: string | null
  requester: {
    employee: EmployeeLite | null
    shift: ShiftLite | null
  }
  target: {
    employee_id: string | null
    employee: EmployeeLite | null
    shift: ShiftLite | null
  }
}

export type SwapEmployeeOption = { id: string; label: string }

function statusBadgeVariant(status: string): BadgeProps["variant"] {
  if (status === "manager_approved") return "success"
  if (status === "accepted") return "info"
  if (status === "pending") return "warning"
  if (status === "denied") return "error"
  return "secondary"
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusBadgeVariant(status)}>
      {status.replace(/_/g, " ")}
    </Badge>
  )
}

function describeShift(shift: ShiftLite | null): string {
  if (!shift) return "Shift unavailable"
  return `${formatDateOnly(shift.starts_at)} · ${formatTimeRange(shift.starts_at, shift.ends_at)}`
}

function nameOf(emp: EmployeeLite | null): string {
  if (!emp) return "Unknown"
  const code = emp.employee_code ? ` (${emp.employee_code})` : ""
  return `${emp.first_name} ${emp.last_name}${code}`
}

export function SwapsList({
  rows,
  employeeOptions,
}: {
  rows: SwapRow[]
  employeeOptions: SwapEmployeeOption[]
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
        No swap requests in this view.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <SwapRowCard key={r.id} row={r} employeeOptions={employeeOptions} />
      ))}
    </div>
  )
}

type Mode = null | "assign" | "approve" | "deny"

function SwapRowCard({
  row,
  employeeOptions,
}: {
  row: SwapRow
  employeeOptions: SwapEmployeeOption[]
}) {
  const [mode, setMode] = useState<Mode>(null)
  const [note, setNote] = useState("")
  const [targetId, setTargetId] = useState("")
  const [pending, startTransition] = useTransition()

  const isTerminal =
    row.status === "denied" ||
    row.status === "cancelled" ||
    row.status === "manager_approved"
  const canAssign =
    row.status === "pending" && row.target.employee_id === null
  // A counter-shift is optional: target_shift_id NULL = one-way coverage
  // (the target simply takes over the requester's shift).
  const canApprove = !isTerminal && row.target.employee_id !== null

  function close() {
    setMode(null)
    setNote("")
    setTargetId("")
  }

  function runApprove() {
    startTransition(async () => {
      const r = await approveSwap(row.id, note.trim() || undefined)
      if (r.ok === true) {
        toast.success(r.message ?? "Approved.")
        close()
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  function runDeny() {
    startTransition(async () => {
      const r = await denySwap(row.id, note.trim() || undefined)
      if (r.ok === true) {
        toast.success(r.message ?? "Denied.")
        close()
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  function runAssign() {
    if (!targetId) {
      toast.error("Pick an employee.")
      return
    }
    startTransition(async () => {
      const r = await assignSwapTarget(row.id, targetId)
      if (r.ok === true) {
        toast.success(r.message ?? "Assigned.")
        close()
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  function runCancel() {
    startTransition(async () => {
      const r = await cancelSwap(row.id)
      if (r.ok === true) toast.success(r.message ?? "Cancelled.")
      else if (r.ok === false) toast.error(r.error)
    })
  }

  const filteredOptions = employeeOptions.filter(
    (o) => o.id !== row.requester.employee?.id
  )

  return (
    <div className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                Requester
              </div>
              <div className="text-sm font-medium">
                {nameOf(row.requester.employee)}
              </div>
              <div className="text-muted-foreground text-xs">
                {describeShift(row.requester.shift)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                Target
              </div>
              <div className="text-sm font-medium">
                {row.target.employee_id
                  ? nameOf(row.target.employee)
                  : "Any qualified"}
              </div>
              <div className="text-muted-foreground text-xs">
                {row.target.shift
                  ? describeShift(row.target.shift)
                  : row.target.employee_id
                    ? "No counter-shift selected"
                    : ""}
              </div>
            </div>
          </div>
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
          <div className="flex flex-wrap justify-end gap-2">
            {canAssign ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMode("assign")}
                disabled={pending}
              >
                Assign target
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                size="sm"
                onClick={() => {
                  setMode("approve")
                  setNote("")
                }}
                disabled={pending}
              >
                Approve
              </Button>
            ) : null}
            {!isTerminal ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMode("deny")
                  setNote("")
                }}
                disabled={pending}
              >
                Deny
              </Button>
            ) : null}
            {!isTerminal ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={runCancel}
                disabled={pending}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {mode === "assign" ? (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
          <label className="text-xs font-medium">Assign to employee</label>
          <Select
            value={targetId || undefined}
            onValueChange={(v) => setTargetId(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="— Select an employee —" />
            </SelectTrigger>
            <SelectContent>
              {filteredOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button size="sm" onClick={runAssign} disabled={pending}>
              {pending ? "Saving…" : "Assign"}
            </Button>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Close
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Assigning marks the swap as accepted. Approving then hands the
            requester&apos;s shift to this employee (coverage); if the request
            includes a counter-shift, the two shifts are exchanged.
          </p>
        </div>
      ) : null}

      {mode === "approve" || mode === "deny" ? (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
          <label className="text-xs font-medium">
            Optional note ({mode === "approve" ? "approval" : "denial"})
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Visible to involved employees"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={mode === "approve" ? runApprove : runDeny}
              disabled={pending}
            >
              {pending
                ? "Saving…"
                : mode === "approve"
                  ? "Confirm approve"
                  : "Confirm deny"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
