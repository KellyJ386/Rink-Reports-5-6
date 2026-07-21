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

import { createRink, updateRink } from "../actions"
import type { ActionState, RinkRow } from "../types"
import { RINK_TEMPLATES, WEEKDAY_LABELS } from "../types"

const NULL_STATE: ActionState = { ok: null }

const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm"

const TEMPLATE_LABELS: Record<string, string> = {
  nhl_200x85: "NHL (200 × 85 ft)",
  olympic_200x100: "Olympic (200 × 100 ft)",
  custom: "Custom dimensions",
}

export function RinkSettingsCard({
  mode,
  rink,
}: {
  mode: "create" | "edit"
  rink?: RinkRow
}) {
  const action = mode === "create" ? createRink : updateRink
  const [state, formAction, pending] = useActionState(action, NULL_STATE)
  const [template, setTemplate] = useState(rink?.rink_template ?? "nhl_200x85")

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === "create" ? "Rink basics" : `Rink settings — ${rink?.name}`}
        </CardTitle>
        <CardDescription>
          Anchor label names where sequence position 1 physically starts (e.g.
          &quot;Zamboni gate&quot;); direction is the drawing order around the
          boards. Weekly checklist items come due on the inspection weekday.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          key={state.ok === true ? "rink-ok" : "rink-form"}
          action={formAction}
          className="grid gap-4 sm:grid-cols-2"
        >
          {mode === "edit" && rink && (
            <input type="hidden" name="id" value={rink.id} />
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-rink-name">Name</Label>
            <Input
              id="db-rink-name"
              name="name"
              required
              defaultValue={rink?.name ?? ""}
              placeholder="Main Rink"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-rink-template">Template</Label>
            <select
              id="db-rink-template"
              name="rink_template"
              className={SELECT_CLASS}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              {RINK_TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {TEMPLATE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {template === "custom" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-rink-length">Length (ft)</Label>
                <Input
                  id="db-rink-length"
                  name="custom_length_ft"
                  inputMode="decimal"
                  defaultValue={rink?.custom_length_ft ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="db-rink-width">Width (ft)</Label>
                <Input
                  id="db-rink-width"
                  name="custom_width_ft"
                  inputMode="decimal"
                  defaultValue={rink?.custom_width_ft ?? ""}
                />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-rink-anchor">Perimeter anchor</Label>
            <Input
              id="db-rink-anchor"
              name="perimeter_anchor_label"
              defaultValue={rink?.perimeter_anchor_label ?? ""}
              placeholder="Zamboni gate"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-rink-direction">Direction</Label>
            <select
              id="db-rink-direction"
              name="perimeter_direction"
              className={SELECT_CLASS}
              defaultValue={rink?.perimeter_direction ?? "clockwise"}
            >
              <option value="clockwise">Clockwise</option>
              <option value="counterclockwise">Counterclockwise</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-rink-weekday">Inspection weekday</Label>
            <select
              id="db-rink-weekday"
              name="inspection_weekday"
              className={SELECT_CLASS}
              defaultValue={String(rink?.inspection_weekday ?? 1)}
            >
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={pending}>
              {pending
                ? "Saving…"
                : mode === "create"
                  ? "Create rink"
                  : "Save rink settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
