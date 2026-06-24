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

import { updateIceOperationsSettings } from "../actions"
import type {
  ActionState,
  Severity,
  SettingsRow,
  TemperatureUnit,
} from "../types"
import { OPERATION_TYPES, SEVERITIES, TEMPERATURE_UNITS } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  settings: SettingsRow | null
}

export function SettingsTab({ settings }: Props) {
  const [state, action, pending] = useActionState(
    updateIceOperationsSettings,
    INITIAL,
  )

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Settings saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const [tempUnit, setTempUnit] = useState<TemperatureUnit>(
    (settings?.temperature_unit as TemperatureUnit) ?? "F",
  )
  const enabled = settings?.alerts_enabled ?? true
  const [sev, setSev] = useState<Severity>(
    (settings?.default_alert_severity as Severity) ?? "warn",
  )

  // Operation visibility — empty/null means all enabled (fail-open).
  const configuredOps = settings?.enabled_operation_types ?? []
  const allOpsEnabled = configuredOps.length === 0
  const isOpChecked = (key: string) =>
    allOpsEnabled || configuredOps.includes(key)

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Ice operations settings</CardTitle>
        <CardDescription>
          One row per facility. Temperatures are stored in Celsius and displayed
          in the unit you choose here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex max-w-xs flex-col gap-1">
            <Label htmlFor="temperature-unit">Temperature unit</Label>
            <input type="hidden" name="temperature_unit" value={tempUnit} />
            <Select value={tempUnit} onValueChange={(v) => setTempUnit(v as TemperatureUnit)}>
              <SelectTrigger id="temperature-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPERATURE_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u === "F" ? "Fahrenheit (°F)" : "Celsius (°C)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Display only. Submissions are stored in Celsius.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="alerts-enabled"
              name="alerts_enabled"
              type="checkbox"
              defaultChecked={enabled}
              className="border-input size-4 rounded border"
            />
            <Label htmlFor="alerts-enabled" className="cursor-pointer">
              Enable ice operations alerts
            </Label>
          </div>

          <div className="flex max-w-xs flex-col gap-1">
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
              Used when alerts are emitted without their own severity.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Visible operations</legend>
            <p className="text-muted-foreground text-xs">
              Choose which operations staff can log at this facility. The
              operation types themselves are built in; this only controls
              visibility. Leaving all unchecked shows every operation.
            </p>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {OPERATION_TYPES.map((op) => (
                <label
                  key={op.key}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <input
                    type="checkbox"
                    name="enabled_operation_types"
                    value={op.key}
                    defaultChecked={isOpChecked(op.key)}
                    className="border-input size-4 rounded border"
                  />
                  {op.label}
                </label>
              ))}
            </div>
          </fieldset>

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
