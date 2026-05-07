"use client"

import { useActionState, useEffect } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import {
  createTemplate,
  updateTemplate,
} from "../../_lib/admin-core-actions"
import type { ActionState, TemplateRow } from "../../_lib/types"

const INITIAL_STATE: ActionState = { ok: null }

type Props = {
  editing: TemplateRow | null
  onClose: () => void
  onSaved: () => void
}

export function TemplateForm({ editing, onClose, onSaved }: Props) {
  const isEdit = editing !== null
  const [createState, createAction, createPending] = useActionState(
    createTemplate,
    INITIAL_STATE
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateTemplate,
    INITIAL_STATE
  )
  const state = isEdit ? updateState : createState
  const pending = isEdit ? updatePending : createPending
  const action = isEdit ? updateAction : createAction

  useEffect(() => {
    if (!state || !("ok" in state)) return
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
      onSaved()
    } else if (state.ok === false) {
      toast.error(state.error)
    }
  }, [state, onSaved])

  const errorMsg =
    state && "ok" in state && state.ok === false ? state.error : null

  return (
    <form
      action={action}
      className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm"
    >
      {isEdit && editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="t_name">Name *</Label>
          <Input
            id="t_name"
            name="name"
            required
            defaultValue={editing?.name ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="t_slug">Slug *</Label>
          <Input
            id="t_slug"
            name="slug"
            required
            defaultValue={editing?.slug ?? ""}
            placeholder="weekday-base"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="t_desc">Description</Label>
        <Textarea
          id="t_desc"
          name="description"
          rows={2}
          defaultValue={editing?.description ?? ""}
        />
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={editing ? editing.is_active : true}
          className="border-input size-4 rounded border"
        />
        Active
      </label>

      {errorMsg && (
        <p role="alert" className="text-destructive text-sm">
          {errorMsg}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : "Create template"}
        </Button>
      </div>
    </form>
  )
}
