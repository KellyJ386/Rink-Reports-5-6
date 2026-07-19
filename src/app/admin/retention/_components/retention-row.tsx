"use client"

import { useActionState, useState } from "react"
import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { LocalDateTime } from "@/components/app/local-datetime"

import { upsertRetentionSetting, triggerManualPurge } from "../actions"
import type { ActionState, RetentionRow } from "../types"
import { PRESET_OPTIONS } from "../types"

interface Props {
  moduleKey: string
  label: string
  description: string
  minDays: number
  existing: RetentionRow | null
}

const INITIAL: ActionState = { ok: null }

export function RetentionRowForm({
  moduleKey,
  label,
  description,
  minDays,
  existing,
}: Props) {
  const [saveState, saveAction, savePending] = useActionState(upsertRetentionSetting, INITIAL)
  const [purgeState, purgeAction, purgePending] = useActionState(triggerManualPurge, INITIAL)
  const [editing, setEditing] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)

  const currentKeepDays = existing?.keep_days ?? 365
  const currentAutoPurge = existing?.auto_purge ?? false
  const lastPurged = existing?.last_purged_at
  const lastCount = existing?.last_purge_count

  if (!editing) {
    return (
      <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{label}</span>
              {currentAutoPurge && (
                <Badge variant="destructive" className="text-xs py-0">
                  Auto-purge on
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{description}</span>
            {lastPurged && (
              <span className="text-xs text-muted-foreground">
                Last purged:{" "}
                <LocalDateTime
                  iso={lastPurged}
                  format="date"
                  options={{ dateStyle: "medium" }}
                />
                {lastCount != null && ` · ${lastCount} record${lastCount === 1 ? "" : "s"} deleted`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right text-sm">
              <div className="font-medium">
                {currentKeepDays === 0 ? "Forever" : `${currentKeepDays} days`}
              </div>
              {!currentAutoPurge && (
                <div className="text-xs text-muted-foreground">Manual purge only</div>
              )}
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
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-4">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="font-medium text-sm">{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
      </div>

      {/* Save settings form */}
      <form action={saveAction} className="flex flex-col gap-3 rounded-md border p-4">
        <input type="hidden" name="module_key" value={moduleKey} />

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">
              Keep for (days) — minimum {minDays}
            </Label>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="number"
                name="keep_days"
                min={minDays}
                step={1}
                defaultValue={currentKeepDays}
                className="h-8 w-24 text-sm"
                required
              />
              <div className="flex gap-1 flex-wrap">
                {PRESET_OPTIONS.filter((o) => o.value === 0 || o.value >= minDays).map((opt) => (
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
            <Label
              htmlFor={`auto_purge_${moduleKey}`}
              className="text-sm cursor-pointer"
            >
              Enable nightly auto-purge
            </Label>
          </div>
        </div>

        {saveState.ok === false && (
          <p className="text-sm text-destructive">{saveState.error}</p>
        )}
        {saveState.ok === true && (
          <p className="text-sm text-success-soft-foreground">
            {saveState.message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={savePending}>
            {savePending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false)
              setConfirmPurge(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>

      {/* Manual purge */}
      {existing && (
        <div className="rounded-md border border-destructive/40 p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-destructive">
              Manual Purge
            </span>
            <span className="text-xs text-muted-foreground">
              Immediately delete all {label} records older than {currentKeepDays === 0 ? "∞" : `${currentKeepDays}`} days.
              This cannot be undone.
            </span>
          </div>

          {!confirmPurge ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="w-fit"
              onClick={() => setConfirmPurge(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />
              Run purge now
            </Button>
          ) : (
            <form action={purgeAction} className="flex flex-col gap-2">
              <input type="hidden" name="module_key" value={moduleKey} />
              <p className="text-sm font-medium text-destructive">
                Are you sure? This will permanently delete records.
              </p>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={purgePending}
                >
                  {purgePending ? "Purging…" : "Confirm purge"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmPurge(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {purgeState.ok === false && (
            <p className="text-sm text-destructive">{purgeState.error}</p>
          )}
          {purgeState.ok === true && (
            <p className="text-sm text-success-soft-foreground">
              {purgeState.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
