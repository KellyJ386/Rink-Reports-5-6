"use client"

import { useState } from "react"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import type { EmployeeLite, JobAreaLite } from "../../_lib/types"

export const OPEN_VALUE = "__open__"
export const NONE_VALUE = "__none__"

export type PopoverState =
  | {
      mode: "create"
      start: Date
      end: Date
      employeeId: string
      jobAreaId: string
    }
  | {
      mode: "edit"
      eventId: string
      start: Date
      end: Date
      employeeId: string
      jobAreaId: string
      /** True when editing a published shift — saving republishes it. */
      published?: boolean
    }

function formatRange(start: Date, end: Date): string {
  return `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`
}

export type SaveOpts = {
  overrideCert?: boolean
  acknowledgeWarnings?: boolean
  overrideReason?: string | null
}

/**
 * Lightweight assign popover lifted from the previous react-big-calendar grid so
 * the new week board keeps the exact create/edit/assign + advisory-warning flow.
 * No Dialog primitive — a small centered overlay stays touch-friendly.
 *
 * Two gate states change the footer:
 *  - cert gap (certWarnings): the assignment is HARD-blocked. A facility
 *    manager can record an override (optional reason) and assign anyway.
 *  - advisory warnings (hour-cap, overtime, …): blocked by facility policy
 *    when `warningsBlocking`, otherwise allowed after an explicit confirm.
 */
export function AssignPopover({
  state,
  error,
  certWarnings,
  advisoryWarnings,
  warningsBlocking,
  warningsLoading,
  employees,
  jobAreas,
  pending,
  onChange,
  onSave,
  onDelete,
  onSaveTemplate,
  onClose,
}: {
  state: PopoverState
  error: string | null
  certWarnings: string[]
  advisoryWarnings: string[]
  warningsBlocking: boolean
  warningsLoading: boolean
  employees: EmployeeLite[]
  jobAreas: JobAreaLite[]
  pending: boolean
  onChange: (next: PopoverState) => void
  onSave: (opts?: SaveOpts) => void
  onDelete: () => void
  onSaveTemplate: (name: string) => void
  onClose: () => void
}) {
  const certBlocked = certWarnings.length > 0
  const advisoryBlockedByPolicy = warningsBlocking && advisoryWarnings.length > 0
  const needsConfirm =
    !certBlocked && !advisoryBlockedByPolicy && advisoryWarnings.length > 0
  const [templateMode, setTemplateMode] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [overrideReason, setOverrideReason] = useState("")
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-col gap-0.5">
          <h3 className="text-base font-semibold tracking-tight">
            {state.mode === "create" ? "New shift" : "Edit shift"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {format(state.start, "EEE, MMM d")} ·{" "}
            {formatRange(state.start, state.end)}
          </p>
          {state.mode === "edit" && state.published ? (
            <p className="mt-1 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              This shift is published — saving republishes it and notifies
              affected staff.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Employee</span>
            <Select
              value={state.employeeId}
              onValueChange={(v) => onChange({ ...state, employeeId: v })}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Assign employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OPEN_VALUE}>Open / unassigned</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.first_name} {e.last_name}
                    {e.is_minor ? " (minor)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Job area</span>
            <Select
              value={state.jobAreaId}
              onValueChange={(v) => onChange({ ...state, jobAreaId: v })}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select job area" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— None —</SelectItem>
                {jobAreas.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        {warningsLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Checking for conflicts…
          </p>
        ) : null}

        {!warningsLoading && certBlocked ? (
          <div
            className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
            role="alert"
          >
            <p className="mb-1 font-medium text-destructive">
              Blocked — missing required certification:
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {certWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <label className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
              Override reason (optional — recorded in the audit log)
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. cert renewal in progress, covered by lead"
                className="h-9"
              />
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Only a facility manager can override, and every override is logged.
            </p>
          </div>
        ) : null}

        {!warningsLoading && advisoryWarnings.length > 0 ? (
          <div
            className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
            role="status"
          >
            <p className="mb-1 font-medium text-foreground">
              {advisoryBlockedByPolicy
                ? "Blocked by facility policy:"
                : "Heads up — this assignment:"}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {advisoryWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            {!advisoryBlockedByPolicy ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Advisory — confirm below to save anyway.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {templateMode ? (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
            <label className="text-sm font-medium" htmlFor="rr-template-name">
              Template name
            </label>
            <Input
              id="rr-template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Morning open"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saves this block&rsquo;s times
              {state.jobAreaId !== NONE_VALUE ? " and job area" : ""} as a
              reusable template.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setTemplateMode(false)
                  setTemplateName("")
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending || templateName.trim().length === 0}
                onClick={() => {
                  onSaveTemplate(templateName.trim())
                  setTemplateMode(false)
                  setTemplateName("")
                }}
              >
                Save template
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mt-4 text-left text-sm font-medium text-primary underline underline-offset-2"
            onClick={() => setTemplateMode(true)}
          >
            Save as template
          </button>
        )}

        <div
          className={cn(
            "mt-5 flex items-center gap-2",
            state.mode === "edit" ? "justify-between" : "justify-end",
          )}
        >
          {state.mode === "edit" ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={pending}
              onClick={onDelete}
            >
              Delete
            </Button>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            {certBlocked ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  onSave({
                    overrideCert: true,
                    acknowledgeWarnings: true,
                    overrideReason: overrideReason.trim() || null,
                  })
                }
              >
                {pending ? "Saving…" : "Override & assign"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={pending || advisoryBlockedByPolicy}
                onClick={() =>
                  onSave(needsConfirm ? { acknowledgeWarnings: true } : undefined)
                }
              >
                {pending
                  ? "Saving…"
                  : needsConfirm
                    ? "Confirm & save"
                    : "Save"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
