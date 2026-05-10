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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { updateIceDepthSettings } from "../actions"
import type {
  ActionState,
  AlertOn,
  MeasurementUnit,
  Severity,
  SettingsRow,
} from "../types"
import { ALERT_ONS, MEASUREMENT_UNITS, SEVERITIES } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  settings: SettingsRow | null
}

export function SettingsTab({ settings }: Props) {
  const [state, action, pending] = useActionState(
    updateIceDepthSettings,
    INITIAL,
  )

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Settings saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const [unit, setUnit] = useState<MeasurementUnit>(
    (settings?.measurement_unit as MeasurementUnit) ?? "inches",
  )
  const lowThr = settings?.low_threshold ?? 1
  const highThr = settings?.high_threshold ?? 2
  const lowColor = settings?.low_color ?? "#1d4ed8"
  const okColor = settings?.ok_color ?? "#16a34a"
  const highColor = settings?.high_color ?? "#dc2626"
  const alerts = settings?.alerts_enabled ?? false
  const [alertOn, setAlertOn] = useState<AlertOn>(
    (settings?.alert_on as AlertOn) ?? "any",
  )
  const [sev, setSev] = useState<Severity>(
    (settings?.default_alert_severity as Severity) ?? "warn",
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ice depth settings</CardTitle>
        <CardDescription>
          One row per facility. Controls measurement unit, severity thresholds,
          colors, and alerting behavior. Existing sessions snapshot the unit
          and thresholds at submit time, so changes here do not reclassify
          history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="measurement-unit">Measurement unit</Label>
              <input type="hidden" name="measurement_unit" value={unit} />
              <Select value={unit} onValueChange={(v) => setUnit(v as MeasurementUnit)}>
                <SelectTrigger id="measurement-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEASUREMENT_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="alert-on">Alert on</Label>
              <input type="hidden" name="alert_on" value={alertOn} />
              <Select value={alertOn} onValueChange={(v) => setAlertOn(v as AlertOn)}>
                <SelectTrigger id="alert-on">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALERT_ONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="low-threshold">Low threshold</Label>
              <Input
                id="low-threshold"
                name="low_threshold"
                type="number"
                step="any"
                required
                defaultValue={lowThr}
              />
              <p className="text-muted-foreground text-xs">
                Below this value, a reading is flagged low.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="high-threshold">High threshold</Label>
              <Input
                id="high-threshold"
                name="high_threshold"
                type="number"
                step="any"
                required
                defaultValue={highThr}
              />
              <p className="text-muted-foreground text-xs">
                Above this value, a reading is flagged high.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ColorField
              id="low-color"
              name="low_color"
              label="Low color"
              defaultValue={lowColor}
            />
            <ColorField
              id="ok-color"
              name="ok_color"
              label="OK color"
              defaultValue={okColor}
            />
            <ColorField
              id="high-color"
              name="high_color"
              label="High color"
              defaultValue={highColor}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center gap-3">
              <input
                id="alerts-enabled"
                name="alerts_enabled"
                type="checkbox"
                defaultChecked={alerts}
                className="border-input size-4 rounded border"
              />
              <Label htmlFor="alerts-enabled" className="cursor-pointer">
                Enable alerts on submitted sessions
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
            </div>
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

function ColorField({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string
  name: string
  label: string
  defaultValue: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          name={name}
          type="color"
          defaultValue={defaultValue}
          className="border-input h-9 w-16 cursor-pointer rounded-md border bg-transparent"
        />
        <span className="text-muted-foreground text-xs font-mono">
          {defaultValue}
        </span>
      </div>
    </div>
  )
}
