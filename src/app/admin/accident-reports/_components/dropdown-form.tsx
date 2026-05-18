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

import { createDropdown, updateDropdown } from "../actions"
import {
  DROPDOWN_CATEGORY_LABELS,
  type ActionState,
  type AccidentDropdownRow,
  type DropdownCategory,
} from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: DropdownCategory
  editing: AccidentDropdownRow | null
}

export function DropdownForm(props: Props) {
  const formKey = props.editing
    ? `edit:${props.editing.id}`
    : `new:${props.category}`
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md overflow-y-auto sm:max-w-md"
      >
        <DropdownFormBody key={formKey} {...props} />
      </SheetContent>
    </Sheet>
  )
}

function readTriggersAlert(metadata: unknown): boolean {
  if (
    metadata &&
    typeof metadata === "object" &&
    "triggers_alert" in (metadata as Record<string, unknown>)
  ) {
    return Boolean(
      (metadata as Record<string, unknown>).triggers_alert,
    )
  }
  return false
}

function DropdownFormBody({ onOpenChange, category, editing }: Props) {
  const isEdit = editing !== null
  const [createState, createAction, createPending] = useActionState(
    createDropdown,
    INITIAL,
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateDropdown,
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

  const isSeverity = category === "severity"
  const isMedicalAttention = category === "medical_attention"
  const defaultColor = isSeverity ? "#ef4444" : "#6366f1"

  const triggersAlertDefault = isEdit
    ? readTriggersAlert(editing?.metadata ?? {})
    : false

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {isEdit ? "Edit value" : "New value"}
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {DROPDOWN_CATEGORY_LABELS[category]}
          </span>
        </SheetTitle>
        <SheetDescription>
          {isEdit
            ? "Update the value's key, label, color, sort order, or activation."
            : "Values shown on the staff accident report form for this category."}
        </SheetDescription>
      </SheetHeader>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="category" value={category} />
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
            placeholder="e.g. medical_office"
            pattern="^[a-z0-9_]+$"
          />
          <p className="text-muted-foreground text-xs">
            Lowercase letters, digits, and underscores. Unique within this
            category for this facility.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display_name">Display name<RequiredMark /></Label>
          <Input
            id="display_name"
            name="display_name"
            required
            defaultValue={editing?.display_name ?? ""}
            placeholder="e.g. Medical Office Visit"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              name="color"
              type="color"
              defaultValue={editing?.color ?? defaultColor}
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

        {isMedicalAttention && (
          <label className="bg-muted/30 flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              name="triggers_alert"
              defaultChecked={triggersAlertDefault}
              className="border-input mt-0.5 size-4 rounded border"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Triggers communication alert</span>
              <span className="text-muted-foreground text-xs">
                When the staff selects this medical-attention level, fire a
                comms alert (e.g. ER, Hospitalization). Stored as
                <code className="bg-background mx-1 rounded px-1 font-mono text-[11px]">
                  metadata.triggers_alert
                </code>
                .
              </span>
            </span>
          </label>
        )}

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
                : "Create value"}
          </Button>
        </div>
      </form>
    </>
  )
}
