"use client"

import { useActionState } from "react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { upsertRetentionSetting } from "../actions"
import type { ActionState, RetentionRow } from "../types"
import { PRESET_OPTIONS } from "../types"

interface Props {
  moduleKey: string
  label: string
  description: string
  existing: RetentionRow | null
}

const INITIAL: ActionState = { ok: null }

export function RetentionRowForm({ moduleKey, label, description, existing }: Props) {
  const [state, formAction, pending] = useActionState(upsertRetentionSetting, INITIAL)
  const [editing, setEditing] = useState(false)

  const currentKeepDays = existing?.keep_days ?? 365
  const currentAutoPurge = existing?.auto_purge ?? false

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-medium text-sm">{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-sm font-medium">{currentKeepDays} days</div>
            <div className="text-xs text-muted-foreground">
              {currentAutoPurge ? "Auto-purge on" : "Auto-purge off"}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      action={formAction}
      className="rounded-md border px-4 py-3 flex flex-col gap-3"
    >
      <input type="hidden" name="module_key" value={moduleKey} />

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-medium text-sm">{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Keep for (days)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              name="keep_days"
              min={30}
              step={1}
              defaultValue={currentKeepDays}
              className="h-8 w-24 text-sm"
              required
            />
            <div className="flex gap-1 flex-wrap">
              {PRESET_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="rounded border px-2 py-0.5 text-xs hover:bg-accent transition-colors"
                  onClick={(e) => {
                    const form = (e.target as HTMLElement).closest("form")
                    if (!form) return
                    const input = form.querySelector<HTMLInputElement>(
                      'input[name="keep_days"]',
                    )
                    if (input) input.value = String(opt.value)
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pb-0.5">
          <input
            type="checkbox"
            name="auto_purge"
            id={`auto_purge_${moduleKey}`}
            defaultChecked={currentAutoPurge}
            className="h-4 w-4 rounded border"
          />
          <Label htmlFor={`auto_purge_${moduleKey}`} className="text-sm cursor-pointer">
            Enable auto-purge
          </Label>
        </div>
      </div>

      {state.ok === false && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state.ok === true && (
        <p className="text-sm text-green-600 dark:text-green-400">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
