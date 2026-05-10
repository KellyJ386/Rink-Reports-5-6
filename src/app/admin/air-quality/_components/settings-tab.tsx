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
import { Textarea } from "@/components/ui/textarea"

import { updateAirQualitySettings } from "../actions"
import type { ActionState, Severity, SettingsRow } from "../types"
import { SEVERITIES } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  settings: SettingsRow | null
  jurisdictions: string[]
}

export function SettingsTab({ settings, jurisdictions }: Props) {
  const [state, action, pending] = useActionState(
    updateAirQualitySettings,
    INITIAL,
  )

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Settings saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const enabled = settings?.alerts_enabled ?? true
  const [sev, setSev] = useState<Severity>(
    (settings?.default_alert_severity as Severity) ?? "warn",
  )
  const testingFreq = settings?.testing_frequency ?? ""
  const defaultJurisdiction = settings?.default_jurisdiction ?? ""

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Air quality settings</CardTitle>
        <CardDescription>
          One row per facility. Controls alerting, testing cadence, and the
          default jurisdiction used for new compliance rules.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="testing-frequency">Testing frequency</Label>
            <Textarea
              id="testing-frequency"
              name="testing_frequency"
              defaultValue={testingFreq}
              rows={3}
              placeholder="e.g. CO every 2 hours during sessions, CO2 once per shift."
            />
            <p className="text-muted-foreground text-xs">
              Plain text. Shown to staff submitting reports.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="default-jurisdiction">Default jurisdiction</Label>
            <Input
              id="default-jurisdiction"
              name="default_jurisdiction"
              defaultValue={defaultJurisdiction}
              list="jurisdictions-list"
              placeholder="e.g. us_federal"
            />
            <datalist id="jurisdictions-list">
              {jurisdictions.map((j) => (
                <option key={j} value={j} />
              ))}
            </datalist>
            <p className="text-muted-foreground text-xs">
              Pre-fills the jurisdiction field when adding a compliance rule.
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
              Enable air quality alerts
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
              Used when a threshold triggers without its own severity.
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
