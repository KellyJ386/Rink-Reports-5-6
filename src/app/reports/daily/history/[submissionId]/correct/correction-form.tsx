"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import { fileOwnCorrection } from "../../../actions"

type ItemView = {
  id: string
  checklist_item_id: string | null
  label_snapshot: string
  is_checked: boolean
}

export function CorrectionForm({
  submissionId,
  items,
}: {
  submissionId: string
  items: ItemView[]
}) {
  const router = useRouter()
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((it) => [it.id, it.is_checked]))
  )
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  function onSubmit() {
    if (!reason.trim()) {
      toast.error("A correction reason is required.")
      return
    }
    startTransition(async () => {
      const r = await fileOwnCorrection({
        submissionId,
        reason,
        items: items.map((it) => ({
          checklist_item_id: it.checklist_item_id,
          label_snapshot: it.label_snapshot,
          is_checked: checks[it.id] ?? it.is_checked,
        })),
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Correction filed. The original stays on record.")
      router.push("/reports/daily/history")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This submission has no checklist items; the correction will record
          your reason only.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={checks[it.id] ?? it.is_checked}
                onChange={(e) =>
                  setChecks((prev) => ({ ...prev, [it.id]: e.target.checked }))
                }
                className="border-input size-4 rounded border"
              />
              <span className="text-sm">{it.label_snapshot}</span>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        required
        placeholder="What was wrong? (required — kept on record with the correction)"
      />
      <div className="flex justify-end">
        <Button type="button" onClick={onSubmit} disabled={pending} className="h-11">
          {pending ? "Filing…" : "File correction"}
        </Button>
      </div>
    </div>
  )
}
