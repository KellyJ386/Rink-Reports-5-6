"use client"

import { useActionState } from "react"
import { useEffect } from "react"
import { ShieldCheck, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

import { approveAuditDestruction, cancelAuditDestruction } from "../actions"
import type { ActionState } from "../types"

export type DestructionBatchView = {
  id: string
  staged_count: number
  status: string
  approved_by_1: string | null
  approved_at_1: string | null
  created_at: string
  first_approver_label: string | null
}

const initialState: ActionState = { ok: null }

function BatchRow({ batch }: { batch: DestructionBatchView }) {
  const [approveState, approveAction] = useActionState(
    approveAuditDestruction,
    initialState,
  )
  const [cancelState, cancelAction] = useActionState(
    cancelAuditDestruction,
    initialState,
  )

  useEffect(() => {
    if (approveState.ok === true && approveState.message) toast.success(approveState.message)
    if (approveState.ok === false) toast.error(approveState.error)
  }, [approveState])
  useEffect(() => {
    if (cancelState.ok === true && cancelState.message) toast.success(cancelState.message)
    if (cancelState.ok === false) toast.error(cancelState.error)
  }, [cancelState])

  const awaitingSecond = batch.approved_by_1 !== null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {batch.staged_count} record{batch.staged_count === 1 ? "" : "s"} staged{" "}
            {new Date(batch.created_at).toLocaleDateString(undefined, {
              dateStyle: "medium",
            })}
          </span>
          {awaitingSecond ? (
            <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-current">
              1 of 2 approvals
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Awaiting first approval
            </Badge>
          )}
        </div>
        {awaitingSecond ? (
          <span className="text-xs text-muted-foreground">
            First approved by {batch.first_approver_label ?? "an admin"} — a
            different admin must give the second approval.
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Records are recoverable until two different admins approve
            destruction.
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <form action={cancelAction}>
          <input type="hidden" name="batch_id" value={batch.id} />
          <Button type="submit" variant="outline" size="sm" className="gap-1.5">
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            Cancel &amp; restore
          </Button>
        </form>
        <form action={approveAction}>
          <input type="hidden" name="batch_id" value={batch.id} />
          <Button type="submit" variant="destructive" size="sm" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {awaitingSecond ? "Give second approval" : "Approve destruction"}
          </Button>
        </form>
      </div>
    </div>
  )
}

/**
 * "The locked bin": audit-log rows past retention are staged here by the
 * nightly purge instead of being deleted (migration 213). Destroying a batch
 * takes two different admins; cancelling restores every row.
 */
export function PendingDestructionCard({
  batches,
}: {
  batches: DestructionBatchView[]
}) {
  if (batches.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log — pending destruction</CardTitle>
        <CardDescription>
          Expired audit records are moved here before destruction. Nothing is
          permanently deleted until two different admins approve; cancelling a
          batch restores its records to the audit log unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {batches.map((b) => (
          <BatchRow key={b.id} batch={b} />
        ))}
      </CardContent>
    </Card>
  )
}
