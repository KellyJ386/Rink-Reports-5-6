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

import { createIncidentType, updateIncidentType } from "../actions"
import type { ActionState, IncidentTypeRow } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: IncidentTypeRow | null
}

export function IncidentTypeForm(props: Props) {
  const formKey = props.editing ? `edit:${props.editing.id}` : "new"
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md overflow-y-auto sm:max-w-md"
      >
        <IncidentTypeFormBody key={formKey} {...props} />
      </SheetContent>
    </Sheet>
  )
}

function IncidentTypeFormBody({ onOpenChange, editing }: Props) {
  const isEdit = editing !== null
  const [createState, createAction, createPending] = useActionState(
    createIncidentType,
    INITIAL,
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateIncidentType,
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
        <SheetTitle>{isEdit ? "Edit incident type" : "New incident type"}</SheetTitle>
        <SheetDescription>
          {isEdit
            ? "Update the type's name, slug, color, sort order, or activation."
            : "Categories shown on the staff incident report form."}
        </SheetDescription>
      </SheetHeader>

      <form action={action} className="flex flex-col gap-4">
        {isEdit && editing && (
          <input type="hidden" name="id" value={editing.id} />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name<RequiredMark /></Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={editing?.name ?? ""}
            placeholder="Safety Concern"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
            name="slug"
            defaultValue={editing?.slug ?? ""}
            placeholder="auto-generated from name if blank"
            pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
          />
          <p className="text-muted-foreground text-xs">
            Lowercase letters, digits, and hyphens.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              name="color"
              type="color"
              defaultValue={editing?.color ?? "#6366f1"}
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
                : "Create type"}
          </Button>
        </div>
      </form>
    </>
  )
}
