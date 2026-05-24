"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import { assignOpenShift } from "../_lib/admin-core-actions"
import {
  formatDateOnly,
  formatTimeRange,
} from "../_lib/datetime"
import {
  approveSwap,
  decideTimeOffRequest,
  denySwap,
} from "../_lib/governance-actions"

export type EmployeeOption = { id: string; label: string }

export type PendingSwap = {
  id: string
  requesterName: string
  targetName: string | null
  requesterShift: { starts_at: string; ends_at: string } | null
  createdAt: string
}

export type PendingTimeOff = {
  id: string
  employeeName: string
  starts_at: string
  ends_at: string
  reason: string | null
  createdAt: string
}

export type OpenShiftItem = {
  id: string
  starts_at: string
  ends_at: string
  departmentName: string
  roleLabel: string | null
}

export function PendingSwapsPanel({ rows }: { rows: PendingSwap[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-6 text-sm">
        No pending swap requests.
      </p>
    )
  }
  return (
    <ul className="divide-border divide-y">
      {rows.map((r) => (
        <li key={r.id}>
          <SwapItem row={r} />
        </li>
      ))}
    </ul>
  )
}

function SwapItem({ row }: { row: PendingSwap }) {
  const [mode, setMode] = useState<null | "approve" | "deny">(null)
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  function run(action: "approve" | "deny") {
    startTransition(async () => {
      const fn = action === "approve" ? approveSwap : denySwap
      const r = await fn(row.id, note.trim() || undefined)
      if (r.ok === true) {
        toast.success(r.message ?? (action === "approve" ? "Approved." : "Denied."))
        setMode(null)
        setNote("")
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  const shiftLabel = row.requesterShift
    ? `${formatDateOnly(row.requesterShift.starts_at)} · ${formatTimeRange(row.requesterShift.starts_at, row.requesterShift.ends_at)}`
    : "Shift unavailable"

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium">
            {row.requesterName} → {row.targetName ?? "Anyone"}
          </div>
          <div className="text-muted-foreground text-xs">{shiftLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="warning">pending</Badge>
          <Button size="sm" onClick={() => setMode("approve")} disabled={pending}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("deny")}
            disabled={pending}
          >
            Deny
          </Button>
        </div>
      </div>
      {mode !== null ? (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
          <label className="text-xs font-medium">
            Optional note ({mode === "approve" ? "approval" : "denial"})
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Visible to the requester"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => run(mode)} disabled={pending}>
              {pending ? "Saving…" : `Confirm ${mode}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode(null)
                setNote("")
              }}
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

export function PendingTimeOffPanel({ rows }: { rows: PendingTimeOff[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-6 text-sm">
        No pending time-off requests.
      </p>
    )
  }
  return (
    <ul className="divide-border divide-y">
      {rows.map((r) => (
        <li key={r.id}>
          <TimeOffItem row={r} />
        </li>
      ))}
    </ul>
  )
}

function TimeOffItem({ row }: { row: PendingTimeOff }) {
  const [mode, setMode] = useState<null | "approved" | "denied">(null)
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  function run(decision: "approved" | "denied") {
    startTransition(async () => {
      const r = await decideTimeOffRequest(row.id, decision, note.trim() || undefined)
      if (r.ok === true) {
        toast.success(r.message ?? "Updated.")
        setMode(null)
        setNote("")
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium">{row.employeeName}</div>
          <div className="text-muted-foreground text-xs">
            {formatDateOnly(row.starts_at)} – {formatDateOnly(row.ends_at)}
          </div>
          {row.reason ? <div className="text-sm">{row.reason}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="warning">pending</Badge>
          <Button size="sm" onClick={() => setMode("approved")} disabled={pending}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("denied")}
            disabled={pending}
          >
            Deny
          </Button>
        </div>
      </div>
      {mode !== null ? (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
          <label className="text-xs font-medium">
            Optional note ({mode === "approved" ? "approval" : "denial"})
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Visible to the requesting employee"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => run(mode)} disabled={pending}>
              {pending ? "Saving…" : `Confirm ${mode}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode(null)
                setNote("")
              }}
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

export function OpenShiftsPanel({
  rows,
  employeeOptions,
}: {
  rows: OpenShiftItem[]
  employeeOptions: EmployeeOption[]
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-6 text-sm">
        No open shifts need coverage.
      </p>
    )
  }
  return (
    <ul className="divide-border divide-y">
      {rows.map((r) => (
        <li key={r.id}>
          <OpenShiftItemRow row={r} employeeOptions={employeeOptions} />
        </li>
      ))}
    </ul>
  )
}

function OpenShiftItemRow({
  row,
  employeeOptions,
}: {
  row: OpenShiftItem
  employeeOptions: EmployeeOption[]
}) {
  const [open, setOpen] = useState(false)
  const [employeeId, setEmployeeId] = useState("")
  const [pending, startTransition] = useTransition()

  function run() {
    if (!employeeId) {
      toast.error("Pick an employee.")
      return
    }
    startTransition(async () => {
      const r = await assignOpenShift(row.id, employeeId)
      if (r.ok === true) {
        toast.success(r.message ?? "Assigned.")
        setOpen(false)
        setEmployeeId("")
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium">
            {formatDateOnly(row.starts_at)} · {formatTimeRange(row.starts_at, row.ends_at)}
          </div>
          <div className="text-muted-foreground text-xs">
            {row.departmentName}
            {row.roleLabel ? ` · ${row.roleLabel}` : ""}
          </div>
        </div>
        <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Assign"}
        </Button>
      </div>
      {open ? (
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-3">
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Choose employee" />
            </SelectTrigger>
            <SelectContent>
              {employeeOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={run} disabled={pending}>
            {pending ? "Assigning…" : "Confirm"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function ModuleCard({
  title,
  description,
  href,
  count,
  cta,
}: {
  title: string
  description: string
  href: string
  count?: number | string
  cta?: string
}) {
  return (
    <Link
      href={href}
      className="bg-card border-border/60 hover:border-border hover:bg-accent/40 group flex flex-col gap-2 rounded-xl border p-4 shadow-[var(--shadow-elev-1)] transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {count !== undefined ? (
          <span className="text-muted-foreground bg-muted rounded-md px-2 py-0.5 text-xs font-medium">
            {count}
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      <span className="text-primary mt-1 text-xs font-medium group-hover:underline">
        {cta ?? "Open"} →
      </span>
    </Link>
  )
}
