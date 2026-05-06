"use client"

import { useEffect, useMemo, useState } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  submitDailyReportAction,
  type SubmissionFormState,
} from "../../../actions"

type ChecklistItem = {
  id: string
  label: string
  description: string | null
}

type Props = {
  areaSlug: string
  areaName: string
  templateId: string
  templateName: string
  areaId: string
  items: ChecklistItem[]
}

const initialState: SubmissionFormState = {}

export function SubmissionForm({
  areaSlug,
  areaName,
  templateId,
  templateName,
  areaId,
  items,
}: Props) {
  const [state, formAction] = useActionState(
    submitDailyReportAction,
    initialState
  )

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.id, false]))
  )
  const [note, setNote] = useState("")

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  const itemsJson = useMemo(() => {
    return JSON.stringify(
      items.map((i) => ({
        checklist_item_id: i.id,
        label_snapshot: i.label,
        is_checked: !!checked[i.id],
      }))
    )
  }, [items, checked])

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="area_id" value={areaId} />
      <input type="hidden" name="area_slug" value={areaSlug} />
      <input type="hidden" name="items_json" value={itemsJson} />

      <FormError message={state.error} />

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {templateName}
        </h1>
        <p className="text-sm text-muted-foreground">{areaName}</p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No checklist items on this template. You can still submit.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
          {items.map((item) => {
            const isChecked = !!checked[item.id]
            return (
              <li key={item.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-4 px-4 py-4 transition-colors",
                    isChecked && "bg-accent/40"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) =>
                      setChecked((prev) => ({
                        ...prev,
                        [item.id]: e.target.checked,
                      }))
                    }
                    className="mt-1 size-6 shrink-0 cursor-pointer rounded border-input accent-primary"
                  />
                  <span className="flex flex-col gap-1">
                    <span className="text-base font-medium leading-tight">
                      {item.label}
                    </span>
                    {item.description ? (
                      <span className="text-sm text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="note" className="text-sm font-medium">
          Note (optional)
        </label>
        <Textarea
          id="note"
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          inputMode="text"
          enterKeyHint="done"
          placeholder="Anything to flag for managers?"
        />
      </div>

      <SubmitBar />
    </form>
  )
}

function SubmitBar() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Submitting…" : "Submit"}
    </Button>
  )
}
