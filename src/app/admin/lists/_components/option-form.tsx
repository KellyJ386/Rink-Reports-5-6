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

import { createOption, updateOption } from "../actions"
import type {
  ActionState,
  DomainConfig,
  FacilityDropdownOptionRow,
} from "../types"

const INITIAL: ActionState = { ok: null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: DomainConfig
  editing: FacilityDropdownOptionRow | null
}

export function OptionForm(props: Props) {
  const formKey = props.editing
    ? `edit:${props.editing.id}`
    : `new:${props.config.domain}`
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md overflow-y-auto sm:max-w-md"
      >
        <OptionFormBody key={formKey} {...props} />
      </SheetContent>
    </Sheet>
  )
}

function OptionFormBody({ onOpenChange, config, editing }: Props) {
  const isEdit = editing !== null
  const [createState, createAction, createPending] = useActionState(
    createOption,
    INITIAL,
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateOption,
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
        <SheetTitle>
          {isEdit ? "Edit option" : "New option"}
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {config.label}
          </span>
        </SheetTitle>
        <SheetDescription>
          {isEdit
            ? "Update this option's key, label, color, sort order, or activation."
            : config.description}
        </SheetDescription>
      </SheetHeader>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="domain" value={config.domain} />
        {isEdit && editing && (
          <input type="hidden" name="id" value={editing.id} />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key">
            {config.keyLabel}
            <RequiredMark />
          </Label>
          <Input
            id="key"
            name="key"
            required
            defaultValue={editing?.key ?? ""}
            placeholder={config.keyPlaceholder}
          />
          <p className="text-muted-foreground text-xs">{config.keyHelp}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display_name">
            Display name
            <RequiredMark />
          </Label>
          <Input
            id="display_name"
            name="display_name"
            required
            defaultValue={editing?.display_name ?? ""}
            placeholder="Eastern — New York"
          />
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
                : "Create option"}
          </Button>
        </div>
      </form>
    </>
  )
}
