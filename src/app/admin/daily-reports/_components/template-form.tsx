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
import { Textarea } from "@/components/ui/textarea"

import { createTemplate, updateTemplate } from "../actions"
import type { ActionState, TemplateRow } from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  areaId: string
  editing: TemplateRow | null
}

export function TemplateForm(props: Props) {
  const formKey = props.editing ? `edit:${props.editing.id}` : `new:${props.areaId}`
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md overflow-y-auto sm:max-w-md"
      >
        <TemplateFormBody key={formKey} {...props} />
      </SheetContent>
    </Sheet>
  )
}

function TemplateFormBody({ onOpenChange, areaId, editing }: Props) {
  const isEdit = editing !== null
  const [createState, createAction, createPending] = useActionState(
    createTemplate,
    INITIAL,
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateTemplate,
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
        <SheetTitle>{isEdit ? "Edit template" : "New template"}</SheetTitle>
        <SheetDescription>
          A template is a named checklist within an area (e.g. &ldquo;Opening
          Checklist&rdquo;).
        </SheetDescription>
      </SheetHeader>

      <form action={action} className="flex flex-col gap-4">
        {isEdit && editing ? (
          <input type="hidden" name="id" value={editing.id} />
        ) : (
          <input type="hidden" name="area_id" value={areaId} />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name<RequiredMark /></Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={editing?.name ?? ""}
            placeholder="Opening checklist"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={editing?.description ?? ""}
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
                : "Create template"}
          </Button>
        </div>
      </form>
    </>
  )
}
