"use client"

import { useActionState } from "react"

import { FormError } from "@/components/auth/form-error"
import { SubmitButton } from "@/components/auth/submit-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { loginAction, type LoginState } from "./actions"

const initialState: LoginState = {}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email ?? ""}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <SubmitButton pendingLabel="Signing in...">Sign in</SubmitButton>
    </form>
  )
}
