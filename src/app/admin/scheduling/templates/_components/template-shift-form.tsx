"use client"

import { useActionState, useEffect, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  createTemplateShift,
  deleteTemplateShift,
  updateTemplateShift,
} from "../../_lib/admin-core-actions"
import { DAY_NAMES } from "../../_lib/datetime"
import type {
  ActionState,
  DepartmentLite,
  TemplateShiftRow,
} from "../../_lib/types"

const INITIAL_STATE: ActionState = { ok: null }

type Props = {
  templateId: string
  departments: DepartmentLite[]
  editing: TemplateShiftRow | null
  onClose: () => void
  onSaved: () => void
}

export function TemplateShiftForm(props: Props) {
  const isEdit = props.editing !== null
  const editing = props.editing
  const [createState, createAction, createPending] = useActionState(
    createTemplateShift,
    INITIAL_STATE
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateTemplateShift,
    INITIAL_STATE
  )
  const [deletePending, startDelete] = useTransition()

  const state = isEdit ? updateState : createState
  const pending = isEdit ? updatePending : createPending
  const action = isEdit ? updateAction : createAction

  useEffect(() => {
    if (!state || !("ok" in state)) return
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
      props.onSaved()
    } else if (state.ok === false) {
      toast.error(state.error)
    }
  }, [state, props])

  const errorMsg =
    state && "ok" in state && state.ok === false ? state.error : null

  return (
    <form
      action={action}
      className="bg-muted/40 flex flex-col gap-3 rounded-md border p-4"
    >
      <input type="hidden" name="template_id" value={props.templateId} />
      {isEdit && editing && (
        <input type="hidden" name="id" value={editing.id} />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts_dept">Department *</Label>
          <select
            id="ts_dept"
            name="department_id"
            required
            defaultValue={editing?.department_id ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
          >
            <option value="" disabled>
              Select…
            </option>
            {props.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts_dow">Day *</Label>
          <select
            id="ts_dow"
            name="day_of_week"
            required
            defaultValue={editing ? String(editing.day_of_week) : "1"}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
          >
            {DAY_NAMES.map((label, dow) => (
              <option key={dow} value={dow}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts_count">Staff count *</Label>
          <Input
            id="ts_count"
            name="staff_count"
            type="number"
            min={1}
            required
            defaultValue={editing?.staff_count ?? 1}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts_start">Start time *</Label>
          <Input
            id="ts_start"
            name="start_time"
            type="time"
            required
            defaultValue={editing?.start_time?.slice(0, 5) ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts_end">End time *</Label>
          <Input
            id="ts_end"
            name="end_time"
            type="time"
            required
            defaultValue={editing?.end_time?.slice(0, 5) ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts_break">Break minutes</Label>
          <Input
            id="ts_break"
            name="break_minutes"
            type="number"
            min={0}
            defaultValue={editing?.break_minutes ?? 0}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ts_role">Role label</Label>
        <Input
          id="ts_role"
          name="role_label"
          defaultValue={editing?.role_label ?? ""}
        />
      </div>

      {errorMsg && (
        <p role="alert" className="text-destructive text-sm">
          {errorMsg}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          {isEdit && editing && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deletePending || pending}
              onClick={() => {
                if (!confirm("Delete this slot?")) return
                startDelete(async () => {
                  const res = await deleteTemplateShift(editing.id)
                  if (res.ok === true) {
                    toast.success(res.message ?? "Slot deleted.")
                    props.onSaved()
                  } else if (res.ok === false) {
                    toast.error(res.error)
                  }
                })
              }}
            >
              {deletePending ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Add slot"}
          </Button>
        </div>
      </div>
    </form>
  )
}
