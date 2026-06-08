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
import { OfflineQueuedCard } from "./offline-queued-card"
import {
  equipmentLabel,
  nowForDateTimeLocal,
  type EquipmentOption,
} from "./shared"
import { useOfflineSubmit } from "./use-offline-submit"

type ChecklistItem = {
  id: string
  label: string
  applies_to_equipment_type: string | null
}

type FuelTypeOption = {
  id: string
  name: string
}

type TemplateOption = {
  id: string
  name: string
  fuel_type_id: string
}

type TemplateItemOption = {
  id: string
  template_id: string
  label: string
}

type Props = {
  equipment: EquipmentOption[]
  checklistItems: ChecklistItem[]
  fuelTypes: FuelTypeOption[]
  templates: TemplateOption[]
  templateItems: TemplateItemOption[]
}

const initialState: SubmissionFormState = {}

type ItemState = {
  passed: boolean
  notes: string
}

export function CircleCheckForm({
  equipment,
  checklistItems,
  fuelTypes,
  templates,
  templateItems,
}: Props) {
  const action = submitIceOperationsReport.bind(null, "circle_check")
  const [state, formAction] = useActionState(action, initialState)

  const occurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [equipmentId, setEquipmentId] = useState("")
  const [notes, setNotes] = useState("")
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({})
  // Operator-side override when equipment has no fuel type assigned.
  const [fuelTypeOverride, setFuelTypeOverride] = useState<string>("")

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  const selectedEquipment = useMemo(
    () => equipment.find((e) => e.id === equipmentId) ?? null,
    [equipment, equipmentId]
  )

  const onEquipmentChange = (id: string) => {
    setEquipmentId(id)
    setFuelTypeOverride("")
  }

  // Resolve the effective fuel type: equipment-assigned wins, else operator's
  // pick from the dropdown. Then resolve the template that targets it.
  const effectiveFuelTypeId: string | null =
    selectedEquipment?.fuel_type_id || fuelTypeOverride || null

  const activeTemplate = useMemo(() => {
    if (!effectiveFuelTypeId) return null
    return templates.find((t) => t.fuel_type_id === effectiveFuelTypeId) ?? null
  }, [templates, effectiveFuelTypeId])

  const templateItemsForActive = useMemo(() => {
    if (!activeTemplate) return []
    return templateItems
      .filter((i) => i.template_id === activeTemplate.id)
      .map((i) => ({
        id: i.id,
        label: i.label,
        // Template items aren't bound to legacy FK; flag for downstream code.
        applies_to_equipment_type: null as string | null,
        isTemplateItem: true as const,
      }))
  }, [activeTemplate, templateItems])

  const showFuelTypeOverride =
    !!selectedEquipment &&
    !selectedEquipment.fuel_type_id &&
    fuelTypes.length > 0 &&
    templates.length > 0

  // Filter items: applies to all (null) OR matches selected equipment type.
  // When a template applies, the template's fields replace the legacy list.
  const visibleItems = useMemo(() => {
    if (!selectedEquipment) return []
    if (activeTemplate) {
      return templateItemsForActive
    }
    return checklistItems
      .filter(
        (i) =>
          i.applies_to_equipment_type === null ||
          i.applies_to_equipment_type === selectedEquipment.equipment_type
      )
      .map((i) => ({ ...i, isTemplateItem: false as const }))
  }, [activeTemplate, templateItemsForActive, checklistItems, selectedEquipment])

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

  const resultsArray = useMemo(() => {
    return visibleItems.map((item) => {
      const s = itemStates[item.id]
      const passed = s ? s.passed : true
      const failed_notes = s && !passed ? s.notes.trim() : null
      return {
        // Template items use a separate table than ice_operations_circle_check_items,
        // so we can't satisfy the results-table FK with their id. Persist null
        // and rely on label_snapshot for historical context.
        checklist_item_id: item.isTemplateItem ? null : item.id,
        label_snapshot: item.label,
        passed,
        failed_notes,
      }
    })
  }, [visibleItems, itemStates])

  const resultsJson = useMemo(
    () => JSON.stringify(resultsArray),
    [resultsArray]
  )

  const { queued, handleSubmit } = useOfflineSubmit("circle_check", () => ({
    equipment_id: equipmentId || null,
    occurred_at: occurredAt,
    notes: notes.trim() || null,
    // The offline payload carries the parsed array; `buildInputFromPayload`
    // accepts either an array or a JSON string here.
    circle_check_results: resultsArray,
  }))

  if (queued) return <OfflineQueuedCard />

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <FormError message={state.error} />

      <input type="hidden" name="occurred_at" value={occurredAt} />
      <input type="hidden" name="circle_check_results" value={resultsJson} />
      <input type="hidden" name="equipment_id" value={equipmentId} />

      <div className="flex flex-col gap-2">
        <Label>
          Machine
          <RequiredMark />
        </Label>
        <Select value={equipmentId} onValueChange={onEquipmentChange} required>
          <SelectTrigger>
            <SelectValue placeholder="Select machine" />
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

      {showFuelTypeOverride ? (
        <div className="flex flex-col gap-2">
          <Label>Fuel type</Label>
          <Select value={fuelTypeOverride} onValueChange={setFuelTypeOverride}>
            <SelectTrigger>
              <SelectValue placeholder="Select a fuel type for this check" />
            </SelectTrigger>
            <SelectContent>
              {fuelTypes.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            This machine has no fuel type configured; pick one to load the
            matching template.
          </p>
        </div>
      ) : null}

      {!selectedEquipment ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Select a machine to view the checklist
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Checklist</h2>
            {activeTemplate ? (
              <span className="text-xs text-muted-foreground">
                Using template: <strong>{activeTemplate.name}</strong>
              </span>
            ) : null}
          </div>
          {visibleItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {effectiveFuelTypeId && !activeTemplate
                ? "No template is configured for this fuel type yet."
                : activeTemplate
                  ? "This template has no fields yet."
                  : "No checklist items apply to this machine."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {visibleItems.map((item) => {
                const s = itemStates[item.id]
                const passed = s ? s.passed : true
                const failedNotes = s?.notes ?? ""
                const showNotesError =
                  s && s.passed === false && s.notes.trim().length === 0
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
                          What&apos;s wrong?
                          <RequiredMark />
                        </Label>
                        <Input
                          id={`notes-${item.id}`}
                          type="text"
                          value={failedNotes}
                          onChange={(e) => setNotesFor(item.id, e.target.value)}
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
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">General Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          placeholder="Add any additional notes about the inspection..."
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
