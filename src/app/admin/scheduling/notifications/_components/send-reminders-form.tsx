"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { sendShiftReminders } from "../../_lib/admin-core-actions"
import type { ActionState } from "../../_lib/types"

const INITIAL: ActionState = { ok: null }

export function SendRemindersForm() {
  const [state, formAction, pending] = useActionState(
    sendShiftReminders as (prev: ActionState, fd: FormData) => Promise<ActionState>,
    INITIAL,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send shift reminders</CardTitle>
        <CardDescription>
          Reminders go out automatically (in-app and email) 24 hours before
          each published shift. Use this to send them earlier for a wider
          window. Reminders are de-duplicated — a shift only receives one
          reminder.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reminder-hours" className="text-xs">
              Upcoming window (hours)
            </Label>
            <Input
              id="reminder-hours"
              name="hours"
              type="number"
              min={1}
              max={168}
              defaultValue={24}
              className="h-9 w-24 text-sm"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Sending…" : "Send reminders"}
          </Button>
          {state.ok === false && (
            <p className="w-full text-sm text-destructive">{state.error}</p>
          )}
          {state.ok === true && (
            <p className="w-full text-sm text-success-soft-foreground">
              {(state as ActionState & { message?: string }).message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
