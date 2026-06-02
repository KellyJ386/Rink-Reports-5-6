"use client"

import { useActionState, useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { createIncidentActivity, updateIncidentActivity } from "../actions"
import type { ActionState, ActivityRow } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: ActivityRow | null
}

export function ActivityForm(props: Props) {
  const formKey = props.editing ? `edit:${props.editing.id}` : "new"
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md overflow-y-auto sm:max-w-md"
      >
        <ActivityFormBody key={formKey} {...props} />
      </SheetContent>
    </Sheet>
  )
}

function ActivityFormBody({ onOpenChange, editing }: Props) {
  const isEdit = editing !== null
  const [createState, createAction, createPending] = useActionState(
    createIncidentActivity,
    INITIAL,
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateIncidentActivity,
    INITIAL,
  )

  const state = isEdit ? updateState : createState
  const action = isEdit ? updateAction : createAction
  const pending = isEdit ? updatePending : createPending

  useEffect(() => {
    if (state && "ok" in state && state.ok === true) {
      onOpenChange(false)
    }
  }, [state, onOpenChange])

  const errorMsg =
    state && "ok" in state && state.ok === false ? state.error : null

  return (
    <>
      <SheetHeader>
        <SheetTitle>{isEdit ? "Edit activity" : "New activity"}</SheetTitle>
        <SheetDescription>
          {isEdit
            ? "Update the activity's key, label, color, sort order, or activation."
            : 'Activities describe what was happening (e.g. Public Skating, Hockey). Reporters can also pick "Other".'}
        </SheetDescription>
      </SheetHeader>

      <form action={action} className="flex flex-col gap-4">
        {isEdit && editing && (
          <input type="hidden" name="id" value={editing.id} />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key">Key<RequiredMark /></Label>
          <Input
            id="key"
            name="key"
            required
            defaultValue={editing?.key ?? ""}
            placeholder="public_skating"
            pattern="^[a-z0-9_]+$"
          />
          <p className="text-muted-foreground text-xs">
            Lowercase letters, digits, and underscores. Used internally; can&apos;t
            collide with another activity in this facility.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display_name">Display name<RequiredMark /></Label>
          <Input
            id="display_name"
            name="display_name"
            required
            defaultValue={editing?.display_name ?? ""}
            placeholder="Public Skating"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              name="color"
              type="color"
              defaultValue={editing?.color ?? "#3b82f6"}
              className="h-9 p-1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sort_order">Sort order</Label>
            <Input
              id="sort_order"
              name="sort_order"
              type="number"
              defaultValue={editing?.sort_order ?? 0}
            />
          </div>
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={editing?.is_active ?? true}
              className="border-input size-4 rounded border"
            />
            Active
          </label>
        )}

        {errorMsg && (
          <p role="alert" className="text-destructive text-sm">
            {errorMsg}
          </p>
        )}

        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save changes"
                : "Create activity"}
          </Button>
        </div>
      </form>
    </>
  )
}
