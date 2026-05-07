"use client"

import { useEffect } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { acknowledgeAlert, type AckAlertFormState } from "../actions"

const initialState: AckAlertFormState = {}

export function AcknowledgeAlertForm({ alertId }: { alertId: string }) {
  const router = useRouter()
  const [state, formAction] = useActionState(acknowledgeAlert, initialState)

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    } else if (state.ok) {
      toast.success("Alert acknowledged.")
      router.refresh()
    }
  }, [state, router])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Acknowledge this alert</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <FormError message={state.error} />
          <input type="hidden" name="alert_id" value={alertId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="Anything you want to note about acknowledging this?"
              className="min-h-24 text-base"
            />
          </div>
          <SubmitBar />
        </form>
      </CardContent>
    </Card>
  )
}

function SubmitBar() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Acknowledging…" : "Acknowledge"}
    </Button>
  )
}
