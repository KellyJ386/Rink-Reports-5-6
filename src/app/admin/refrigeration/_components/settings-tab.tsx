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
import { Label } from "@/components/ui/label"

import { updateRefrigerationSettings } from "../actions"
import type { ActionState, SettingsRow, Severity } from "../types"
import { SEVERITIES } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  settings: SettingsRow | null
}

export function SettingsTab({ settings }: Props) {
  const [state, action, pending] = useActionState(
    updateRefrigerationSettings,
    INITIAL,
  )

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Settings saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const enabled = settings?.out_of_range_alerts_enabled ?? false
  const sev: Severity = (settings?.default_alert_severity as Severity) ?? "warn"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refrigeration settings</CardTitle>
        <CardDescription>
          One row per facility. Controls out-of-range alerting behavior.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <input
              id="oor-enabled"
              name="out_of_range_alerts_enabled"
              type="checkbox"
              defaultChecked={enabled}
              className="border-input size-4 rounded border"
            />
            <Label htmlFor="oor-enabled" className="cursor-pointer">
              Enable out-of-range alerts
            </Label>
          </div>
          <div className="flex max-w-sm flex-col gap-1">
            <Label htmlFor="default-sev">Default alert severity</Label>
            <select
              id="default-sev"
              name="default_alert_severity"
              defaultValue={sev}
              className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              Used when a threshold is triggered without its own severity.
            </p>
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
