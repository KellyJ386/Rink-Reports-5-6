"use client"

import { useActionState } from "react"

import { FormError } from "@/components/auth/form-error"
import { SubmitButton } from "@/components/auth/submit-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { updatePasswordAction, type UpdatePasswordState } from "./actions"

const initialState: UpdatePasswordState = {}

export function UpdatePasswordForm({
  initialError,
}: {
  initialError?: string
}) {
  const [state, formAction] = useActionState(
    updatePasswordAction,
    initialState,
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.error ?? initialError} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm_password">Confirm new password</Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <SubmitButton pendingLabel="Saving...">Set password</SubmitButton>
    </form>
  )
}
