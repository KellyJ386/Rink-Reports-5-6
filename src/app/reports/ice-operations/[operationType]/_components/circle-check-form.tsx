"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  submitIceOperationsReport,
  type SubmissionFormState,
} from "../../actions"
import {
  equipmentLabel,
  nowForDateTimeLocal,
  type EquipmentOption,
  type RinkOption,
} from "./shared"

type ChecklistItem = {
  id: string
  label: string
  applies_to_equipment_type: string | null
}

type Props = {
  rinks: RinkOption[]
  equipment: EquipmentOption[]
  checklistItems: ChecklistItem[]
}

const initialState: SubmissionFormState = {}

type ItemState = {
  passed: boolean
  notes: string
}

export function CircleCheckForm({ rinks, equipment, checklistItems }: Props) {
  const action = submitIceOperationsReport.bind(null, "circle_check")
  const [state, formAction] = useActionState(action, initialState)

  const defaultOccurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [rinkId, setRinkId] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt)
  const [notes, setNotes] = useState("")
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({})

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  const selectedEquipment = useMemo(
    () => equipment.find((e) => e.id === equipmentId) ?? null,
    [equipment, equipmentId]
  )

  // Filter items: applies to all (null) OR matches selected equipment type.
  // Until equipment is selected, show only items that apply to all so the
  // user can preview without locking in.
  const visibleItems = useMemo(() => {
    if (!selectedEquipment) {
      return checklistItems.filter(
        (i) => i.applies_to_equipment_type === null
      )
    }
    return checklistItems.filter(
      (i) =>
        i.applies_to_equipment_type === null ||
        i.applies_to_equipment_type === selectedEquipment.equipment_type
    )
  }, [checklistItems, selectedEquipment])

  const setPassed = (id: string, passed: boolean) => {
    setItemStates((prev) => ({
      ...prev,
      [id]: { passed, notes: prev[id]?.notes ?? "" },
    }))
  }
  const setNotesFor = (id: string, notes: string) => {
    setItemStates((prev) => ({
      ...prev,
      [id]: { passed: prev[id]?.passed ?? true, notes },
    }))
  }

  // Compute disabled state: any visible item that's marked failed without
  // notes blocks submit.
  const blockedByEmptyFailNotes = useMemo(() => {
    for (const item of visibleItems) {
      const s = itemStates[item.id]
      if (s && s.passed === false && s.notes.trim().length === 0) {
        return true
      }
    }
    return false
  }, [visibleItems, itemStates])

  const resultsJson = useMemo(() => {
    return JSON.stringify(
      visibleItems.map((item) => {
        const s = itemStates[item.id]
        const passed = s ? s.passed : true
        const failed_notes =
          s && !passed ? s.notes.trim() : null
        return {
          checklist_item_id: item.id,
          label_snapshot: item.label,
          passed,
          failed_notes,
        }
      })
    )
  }, [visibleItems, itemStates])

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError message={state.error} />

      <input
        type="hidden"
        name="circle_check_results"
        value={resultsJson}
      />

      <input type="hidden" name="rink_id" value={rinkId} />
      <input type="hidden" name="equipment_id" value={equipmentId} />

      <div className="flex flex-col gap-2">
        <Label>Rink<RequiredMark /></Label>
        <Select value={rinkId} onValueChange={setRinkId} required>
          <SelectTrigger>
            <SelectValue placeholder="Select a rink" />
          </SelectTrigger>
          <SelectContent>
            {rinks.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Ice Resurfacer<RequiredMark /></Label>
        <Select value={equipmentId} onValueChange={setEquipmentId} required>
          <SelectTrigger>
            <SelectValue placeholder="Select an ice resurfacer" />
          </SelectTrigger>
          <SelectContent>
            {equipment.map((eq) => (
              <SelectItem key={eq.id} value={eq.id}>
                {equipmentLabel(eq)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="occurred_at">When did the check happen?<RequiredMark /></Label>
        <Input
          id="occurred_at"
          name="occurred_at"
          required
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="h-12 text-base"
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Checklist</h2>
        {visibleItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {selectedEquipment
              ? "No checklist items apply to this equipment."
              : "Select an ice resurfacer to see all applicable items."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visibleItems.map((item) => {
              const s = itemStates[item.id]
              const passed = s ? s.passed : true
              const failedNotes = s?.notes ?? ""
              const showNotesError =
                s &&
                s.passed === false &&
                s.notes.trim().length === 0
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-base font-medium">
                      {item.label}
                    </span>
                    <div
                      role="group"
                      aria-label={`Pass or fail: ${item.label}`}
                      className="flex shrink-0 gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => setPassed(item.id, true)}
                        aria-pressed={passed === true}
                        className={cn(
                          "h-11 min-w-20 rounded-full px-4 text-sm font-medium transition-colors",
                          passed === true
                            ? "bg-emerald-600 text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        )}
                      >
                        Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => setPassed(item.id, false)}
                        aria-pressed={passed === false}
                        className={cn(
                          "h-11 min-w-20 rounded-full px-4 text-sm font-medium transition-colors",
                          passed === false
                            ? "bg-red-600 text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        )}
                      >
                        Fail
                      </button>
                    </div>
                  </div>
                  {passed === false ? (
                    <div className="flex flex-col gap-1">
                      <Label
                        htmlFor={`notes-${item.id}`}
                        className="text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        What&apos;s wrong?<RequiredMark />
                      </Label>
                      <Input
                        id={`notes-${item.id}`}
                        type="text"
                        value={failedNotes}
                        onChange={(e) =>
                          setNotesFor(item.id, e.target.value)
                        }
                        required
                        aria-invalid={showNotesError ? "true" : undefined}
                        className={cn(
                          "h-12 text-base",
                          showNotesError &&
                            "border-red-500 focus-visible:ring-red-500/40"
                        )}
                        placeholder="Describe the issue"
                      />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-24 text-base"
        />
      </div>

      <SubmitBar disabled={blockedByEmptyFailNotes} />
      {blockedByEmptyFailNotes ? (
        <p className="text-xs text-red-600">
          Add a note for each failed item before submitting.
        </p>
      ) : null}
    </form>
  )
}

function SubmitBar({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending || disabled}
      className="h-12 w-full text-base"
    >
      {pending ? "Submitting…" : "Submit circle check"}
    </Button>
  )
}
