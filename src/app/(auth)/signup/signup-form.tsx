"use client"

import Link from "next/link"
import { useActionState } from "react"

import { FormError } from "@/components/auth/form-error"
import { SubmitButton } from "@/components/auth/submit-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { signupAction, type SignupState } from "./actions"

const initialState: SignupState = {}

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, initialState)

  if (state.success) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="font-medium text-foreground">Account created.</p>
        {state.needsConfirmation ? (
          <p className="text-muted-foreground">
            Check your email at{" "}
            <span className="font-medium text-foreground">{state.email}</span>{" "}
            to confirm your address before signing in. An administrator will
            assign you to a facility once your account is confirmed.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Your account is ready. An administrator will assign you to a
            facility before you can access the console.
          </p>
        )}
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="full_name">Full name</Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          required
          defaultValue={state.fullName ?? ""}
        />
      </div>
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
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <SubmitButton pendingLabel="Creating account...">
        Create account
      </SubmitButton>
    </form>
  )
}
