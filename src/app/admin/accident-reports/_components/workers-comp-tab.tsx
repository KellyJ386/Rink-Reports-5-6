"use client"

import { useActionState, useEffect } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { LocalDateTime } from "@/components/app/local-datetime"

import { updateWorkersCompInstructions } from "../actions"
import type { ActionState } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  instructions: string
  updatedAt: string | null
  hasRow: boolean
}

export function WorkersCompTab({ instructions, updatedAt, hasRow }: Props) {
  const [state, action, pending] = useActionState(
    updateWorkersCompInstructions,
    INITIAL,
  )

  useEffect(() => {
    if (!state || !("ok" in state)) return
    if (state.ok === false) toast.error(state.error)
    else if (state.ok === true && state.message) toast.success(state.message)
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workers&apos; Compensation instructions</CardTitle>
        <CardDescription>
          Shown to staff when they file an accident report and toggle Workers&apos;
          Comp. Newlines are preserved. Last updated{" "}
          {hasRow ? <LocalDateTime iso={updatedAt} /> : "(not yet saved)"}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <Textarea
            name="instructions"
            defaultValue={instructions}
            rows={14}
            placeholder="Enter the Workers' Comp instructions to display to staff."
            className="font-mono text-sm"
          />
          {state && "ok" in state && state.ok === false && (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
