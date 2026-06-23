"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { sendAirQualityLog, type SendLogState } from "./actions"

const NULL_STATE: SendLogState = { ok: null }

/**
 * Toolbar control to email the current date-range log PDF to one or more
 * recipients. The from/to come from the page's current filter so the sent PDF
 * matches what's on screen.
 */
export function SendLogButton({ from, to }: { from: string; to: string }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    sendAirQualityLog,
    NULL_STATE,
  )

  useEffect(() => {
    if (state.ok === true) toast.success(state.message)
    if (state.ok === false) toast.error(state.error)
  }, [state])

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Send…
      </Button>
    )
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <label className="flex flex-col text-xs font-medium">
        Recipient email(s)
        <Input
          name="recipients"
          type="text"
          required
          placeholder="inspector@example.gov, manager@rink.com"
          className="mt-1 h-9 w-72 text-sm"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Sending…" : "Send PDF"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </form>
  )
}
