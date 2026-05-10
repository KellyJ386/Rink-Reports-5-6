"use client"

import { useActionState, useEffect, useState } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  const [sev, setSev] = useState<Severity>(
    (settings?.default_alert_severity as Severity) ?? "warn",
  )

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
            <input type="hidden" name="default_alert_severity" value={sev} />
            <Select value={sev} onValueChange={(v) => setSev(v as Severity)}>
              <SelectTrigger id="default-sev">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
