"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { publishShiftsInRange } from "../../_lib/admin-core-actions"

type Props = {
  startsAtIso: string
  endsAtIso: string
  label?: string
}

export function PublishButton({
  startsAtIso,
  endsAtIso,
  label = "Publish drafts in window",
}: Props) {
  const [pending, start] = useTransition()
  const router = useRouter()

  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            "Publish all draft shifts in the current window? Affected employees will be notified."
          )
        ) {
          return
        }
        start(async () => {
          const res = await publishShiftsInRange(startsAtIso, endsAtIso)
          if (res.ok === true) {
            toast.success(res.message ?? "Shifts published.")
            router.refresh()
          } else if (res.ok === false) {
            toast.error(res.error)
          }
        })
      }}
    >
      {pending ? "Publishing…" : label}
    </Button>
  )
}
