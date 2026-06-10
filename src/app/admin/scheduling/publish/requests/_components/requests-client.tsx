"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { formatDateTime } from "../../../_lib/datetime"
import {
  approveAndPublishRequest,
  rejectPublishRequest,
} from "../../../_lib/publish-request-actions"

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type CurrentUser = {
  employeeId: string | null
  isSuperAdmin: boolean
}

export type PublishRequestRow = {
  id: string
  facility_id: string
  requested_by_employee_id: string
  range_starts_at: string
  range_ends_at: string
  notes: string | null
  status: "pending" | "rejected" | "published"
  decided_by_employee_id: string | null
  decided_at: string | null
  rejection_reason: string | null
  created_at: string
}

type Props = {
  rows: PublishRequestRow[]
  employees: EmployeeLite[]
  me: CurrentUser
}

// Token-based badge variants (defined in ui/badge) so both themes render
// correctly — never hardcode palette colors here.
const STATUS_BADGE: Record<PublishRequestRow["status"], BadgeProps["variant"]> =
  {
    pending: "warning",
    published: "success",
    rejected: "error",
  }

export function RequestsClient({ rows, employees, me }: Props) {
  const empById = new Map(employees.map((e) => [e.id, e]))
  const name = (id: string | null) => {
    if (!id) return "—"
    const e = empById.get(id)
    return e ? `${e.first_name} ${e.last_name}` : "—"
  }

  const pending = rows.filter((r) => r.status === "pending")
  const decided = rows.filter((r) => r.status !== "pending")

  return (
    <div className="flex flex-col gap-6">
      <Section title={`Pending (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No pending requests.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <PendingCard
                key={r.id}
                row={r}
                requesterName={name(r.requested_by_employee_id)}
                me={me}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Decided (${decided.length})`}>
        {decided.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No decided requests yet.
          </p>
        ) : (
          <div className="overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="border-b px-3 py-2 font-medium">Filed</th>
                  <th className="border-b px-3 py-2 font-medium">Range</th>
                  <th className="border-b px-3 py-2 font-medium">Requester</th>
                  <th className="border-b px-3 py-2 font-medium">Status</th>
                  <th className="border-b px-3 py-2 font-medium">Decided</th>
                  <th className="border-b px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id}>
                    <td className="border-b px-3 py-2 tabular-nums">
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className="border-b px-3 py-2 tabular-nums">
                      {formatDateTime(r.range_starts_at)} –{" "}
                      {formatDateTime(r.range_ends_at)}
                    </td>
                    <td className="border-b px-3 py-2">
                      {name(r.requested_by_employee_id)}
                    </td>
                    <td className="border-b px-3 py-2">
                      <Badge variant={STATUS_BADGE[r.status]}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="border-b px-3 py-2">
                      {r.decided_at ? formatDateTime(r.decided_at) : "—"}
                      {r.decided_by_employee_id ? (
                        <span className="text-muted-foreground block text-xs">
                          by {name(r.decided_by_employee_id)}
                        </span>
                      ) : null}
                    </td>
                    <td className="border-b px-3 py-2">
                      {r.rejection_reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function PendingCard({
  row,
  requesterName,
  me,
}: {
  row: PublishRequestRow
  requesterName: string
  me: CurrentUser
}) {
  const [pending, start] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState("")
  const router = useRouter()

  const isOwn = me.employeeId === row.requested_by_employee_id
  const canDecide = !isOwn // RLS + CHECK will block anyway, but hide the buttons

  function onApprove() {
    if (!confirm("Approve and publish all draft shifts in this window?")) {
      return
    }
    start(async () => {
      const res = await approveAndPublishRequest(row.id)
      if (res.ok === true) {
        toast.success(res.message ?? "Approved.")
        router.refresh()
      } else if (res.ok === false) {
        toast.error(res.error)
      }
    })
  }

  function onReject() {
    if (!reason.trim()) {
      toast.error("Provide a reason for the rejection.")
      return
    }
    start(async () => {
      const res = await rejectPublishRequest(row.id, reason)
      if (res.ok === true) {
        toast.success(res.message ?? "Rejected.")
        setShowReject(false)
        setReason("")
        router.refresh()
      } else if (res.ok === false) {
        toast.error(res.error)
      }
    })
  }

  return (
    <li className="bg-card flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium tabular-nums">
            {formatDateTime(row.range_starts_at)} –{" "}
            {formatDateTime(row.range_ends_at)}
          </div>
          <div className="text-muted-foreground text-xs">
            Requested by {requesterName} · {formatDateTime(row.created_at)}
          </div>
        </div>
        <Badge variant={STATUS_BADGE[row.status]}>{row.status}</Badge>
      </div>

      {row.notes ? (
        <p className="text-sm whitespace-pre-wrap">{row.notes}</p>
      ) : null}

      {canDecide ? (
        showReject ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejection (required)"
              rows={2}
              className="border-input bg-background focus-visible:ring-ring/50 rounded-md border px-2 py-1 text-sm focus-visible:ring-[3px]"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={onReject}
              >
                {pending ? "Rejecting…" : "Confirm reject"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setShowReject(false)
                  setReason("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button type="button" disabled={pending} onClick={onApprove}>
              {pending ? "Approving…" : "Approve & publish"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setShowReject(true)}
            >
              Reject
            </Button>
          </div>
        )
      ) : (
        <p className="text-muted-foreground text-xs">
          You filed this request — a different admin must approve or reject it.
        </p>
      )}
    </li>
  )
}
