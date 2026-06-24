"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TIER_LEVELS } from "@/app/reports/air-quality/_lib/compliance"
import type {
  MetricDef,
  ProfileTiers,
  TierLevel,
} from "@/app/reports/air-quality/_lib/compliance"

import { saveComplianceProfileConfig } from "../actions"
import type { ActionState } from "../types"

const NULL_STATE: ActionState = { ok: null }

export type ProfileForPanel = {
  id: string
  jurisdiction: string
  display_name: string
  method: "single" | "twa_1hr"
  is_binding: boolean
  guidance_note: string | null
  metrics: MetricDef[]
  tiers: ProfileTiers
}

type Props = {
  profiles: ProfileForPanel[]
  selectedProfileId: string | null
  activeMetricKeys: string[]
  overrides: ProfileTiers
  escalationConfig: Record<string, string>
  submitRoles: string[]
  viewRoles: string[]
}

const TIER_LABEL: Record<TierLevel, string> = {
  corrective: "Corrective",
  notification: "Notification",
  evacuation: "Evacuation",
}

export function ComplianceProfilePanel({
  profiles,
  selectedProfileId,
  activeMetricKeys,
  overrides,
  escalationConfig,
  submitRoles,
  viewRoles,
}: Props) {
  const [profileId, setProfileId] = useState<string>(selectedProfileId ?? "")
  const [state, action, pending] = useActionState(
    saveComplianceProfileConfig,
    NULL_STATE,
  )

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const selected = useMemo(
    () => profiles.find((p) => p.id === profileId) ?? null,
    [profiles, profileId],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance profile (jurisdiction)</CardTitle>
        <CardDescription>
          Choose the regulatory profile for this facility. The reading form,
          threshold tiers, sampling cadence, and escalation steps all derive
          from it. You may tighten a threshold below the regulatory floor, but
          not loosen it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-5">
          <div className="flex max-w-md flex-col gap-1.5">
            <Label htmlFor="aq-profile">Jurisdiction profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="aq-profile">
                <SelectValue placeholder="Select a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="compliance_profile_id" value={profileId} />
          </div>

          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selected.is_binding ? "error" : "secondary"}>
                  {selected.is_binding ? "Binding regulation" : "Guidance"}
                </Badge>
                <Badge variant="secondary">
                  {selected.method === "twa_1hr"
                    ? "1-hour TWA method"
                    : "Single-sample method"}
                </Badge>
              </div>
              {selected.guidance_note ? (
                <p className="text-muted-foreground text-sm">
                  {selected.guidance_note}
                </p>
              ) : null}

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">
                  Metrics tracked
                </legend>
                <div className="flex flex-wrap gap-4">
                  {selected.metrics.map((m) => (
                    <label
                      key={m.key}
                      htmlFor={`metric-${m.key}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        id={`metric-${m.key}`}
                        type="checkbox"
                        name="active_metrics"
                        value={m.key}
                        defaultChecked={
                          activeMetricKeys.length === 0 ||
                          activeMetricKeys.includes(m.key)
                        }
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      {m.label} ({m.unit})
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-semibold">
                  Threshold overrides (tighten only)
                </legend>
                <p className="text-muted-foreground text-xs">
                  Leave blank to use the regulatory ceiling shown. A value must
                  be at or below the floor.
                </p>
                <div className="flex flex-col gap-4">
                  {selected.metrics.map((m) => (
                    <div key={m.key} className="flex flex-col gap-2">
                      <span className="text-muted-foreground text-xs font-semibold uppercase">
                        {m.label}
                      </span>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {TIER_LEVELS.map((tier) => {
                          const floor = selected.tiers[m.key]?.[tier]?.max
                          if (floor === undefined || floor === null) return null
                          const overrideVal = overrides[m.key]?.[tier]?.max
                          return (
                            <div
                              key={tier}
                              className="flex flex-col gap-1"
                            >
                              <Label
                                htmlFor={`ov-${m.key}-${tier}`}
                                className="text-xs"
                              >
                                {TIER_LABEL[tier]} (≤ {floor} {m.unit})
                              </Label>
                              <Input
                                id={`ov-${m.key}-${tier}`}
                                name={`override_${m.key}_${tier}`}
                                type="number"
                                step="any"
                                inputMode="decimal"
                                placeholder={String(floor)}
                                defaultValue={
                                  overrideVal !== undefined &&
                                  overrideVal !== null
                                    ? String(overrideVal)
                                    : ""
                                }
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-semibold">
                  Escalation steps
                </legend>
                <p className="text-muted-foreground text-xs">
                  Shown to operators in the reading form when a reading reaches
                  each tier. Leave blank to use the default guidance.
                </p>
                {TIER_LEVELS.map((tier) => (
                  <div key={tier} className="flex flex-col gap-1">
                    <Label htmlFor={`esc-${tier}`} className="text-xs">
                      {TIER_LABEL[tier]}
                    </Label>
                    <Textarea
                      id={`esc-${tier}`}
                      name={`escalation_${tier}`}
                      rows={2}
                      defaultValue={escalationConfig[tier] ?? ""}
                      placeholder={`Contacts / actions for ${TIER_LABEL[tier].toLowerCase()} level`}
                    />
                  </div>
                ))}
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-semibold">Role access</legend>
                <p className="text-muted-foreground text-xs">
                  Comma-separated role keys. Advisory — actual access is still
                  governed by each user&apos;s module permissions.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="submit-roles" className="text-xs">
                      May submit readings
                    </Label>
                    <Input
                      id="submit-roles"
                      name="submit_roles"
                      defaultValue={submitRoles.join(", ")}
                      placeholder="e.g. staff, supervisor"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="view-roles" className="text-xs">
                      May view logs
                    </Label>
                    <Input
                      id="view-roles"
                      name="view_roles"
                      defaultValue={viewRoles.join(", ")}
                      placeholder="e.g. admin, gm"
                    />
                  </div>
                </div>
              </fieldset>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No profile selected — the legacy per-facility thresholds below
              still apply.
            </p>
          )}

          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save compliance profile"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
