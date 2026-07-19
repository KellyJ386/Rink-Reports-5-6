"use client"

import { useState, useTransition } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LocalDateTime } from "@/components/app/local-datetime"

import { checkInviteServiceHealth } from "../actions"
import type { InviteServiceHealth } from "../types"

const INITIAL: InviteServiceHealth = { ok: null }

export function InviteServiceHealthCard() {
  const [state, setState] = useState<InviteServiceHealth>(INITIAL)
  const [pending, startTransition] = useTransition()

  function runCheck() {
    startTransition(async () => {
      const result = await checkInviteServiceHealth()
      setState(result)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email invite service</CardTitle>
        <CardDescription>
          Verifies that this deployment&apos;s service-role key can authenticate
          against Supabase Auth&apos;s admin API — the same path the employee
          Invite button uses to email a sign-in link.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runCheck}
            disabled={pending}
          >
            {pending ? "Checking…" : "Run health check"}
          </Button>
          <StatusBadge state={state} />
        </div>
        {state.ok === true && (
          <p className="text-xs text-muted-foreground">
            Last checked <LocalDateTime iso={state.checkedAt} />.
          </p>
        )}
        {state.ok === false && (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-destructive">{state.detail}</p>
            <p className="text-xs text-muted-foreground">
              Last checked <LocalDateTime iso={state.checkedAt} />.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ state }: { state: InviteServiceHealth }) {
  if (state.ok === null) {
    return <Badge variant="secondary">Not checked</Badge>
  }
  if (state.ok === true) {
    return <Badge variant="success">OK</Badge>
  }
  const label =
    state.reason === "not_configured"
      ? "Not configured"
      : state.reason === "unauthorized"
        ? "Key invalid (401)"
        : state.reason === "forbidden"
          ? "Wrong project (403)"
          : state.status
            ? `Error (${state.status})`
            : "Error"
  return <Badge variant="destructive">{label}</Badge>
}
