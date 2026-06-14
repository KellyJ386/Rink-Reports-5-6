"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { requestSchedulePublish } from "../../_lib/publish-request-actions"

type Props = {
  startsAtIso: string
  endsAtIso: string
  label?: string
}

export function PublishButton({
  startsAtIso,
  endsAtIso,
  label = "Request publish for window",
}: Props) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const router = useRouter()

  function submit() {
    start(async () => {
      const res = await requestSchedulePublish(startsAtIso, endsAtIso, notes)
      if (res.ok === true) {
        toast.success(res.message ?? "Publish request filed.")
        setOpen(false)
        setNotes("")
        router.refresh()
      } else if (res.ok === false) {
        toast.error(res.error)
      }
    })
  }

  if (!open) {
    return (
      <Button type="button" disabled={pending} onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }

  return (
    <div className="bg-card flex flex-col gap-2 rounded-md border p-3">
      <p className="text-sm">
        File a publish request for this window. A different admin must approve
        before shifts are released to staff.
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional notes for the approver"
        rows={2}
        className="border-input bg-background focus-visible:ring-ring/50 rounded-md border px-2 py-1 text-sm focus-visible:ring-[3px]"
      />
      <div className="flex gap-2">
        <Button type="button" disabled={pending} onClick={submit}>
          {pending ? "Filing…" : "File request"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setOpen(false)
            setNotes("")
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
