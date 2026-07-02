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
import {
  galToL,
  galToPct,
  lToGal,
  pctToGal,
  roundVolume,
  waterUsageUnitLabel,
  type WaterUsageUnit,
} from "@/lib/units"

import {
  submitIceOperationsReport,
  type SubmissionFormState,
} from "../../actions"
import { OfflineQueuedCard } from "./offline-queued-card"
import {
  equipmentLabel,
  nowForDateTimeLocal,
  type EquipmentOption,
  type RinkOption,
} from "./shared"
import { useOfflineSubmit } from "./use-offline-submit"

type Props = {
  rinks: RinkOption[]
  equipment: EquipmentOption[]
}

const initialState: SubmissionFormState = {}

const WATER_UNITS: readonly WaterUsageUnit[] = ["gal", "L", "pct"]

/** Convert a display value from one water-usage unit to another via gallons. */
function convertWaterDisplay(
  value: string,
  fromUnit: WaterUsageUnit,
  toUnit: WaterUsageUnit,
  tankCapacityGal: number | null,
): string {
  if (value.trim() === "" || fromUnit === toUnit) return value
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  const gal =
    fromUnit === "gal" ? n : fromUnit === "L" ? lToGal(n) : pctToGal(n, tankCapacityGal)
  if (gal === null) return value
  const converted =
    toUnit === "gal" ? gal : toUnit === "L" ? galToL(gal) : galToPct(gal, tankCapacityGal)
  if (converted === null) return value
  return String(roundVolume(converted))
}

export function IceMakeForm({ rinks, equipment }: Props) {
  const action = submitIceOperationsReport.bind(null, "ice_make")
  const [state, formAction] = useActionState(action, initialState)

  const occurredAt = useMemo(() => nowForDateTimeLocal(), [])
  const [rinkId, setRinkId] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [waterUsed, setWaterUsed] = useState("")
  const [waterUnit, setWaterUnit] = useState<WaterUsageUnit>("gal")
  const [machineHours, setMachineHours] = useState("")
  const [snowTaken, setSnowTaken] = useState("")
  const [timeOn, setTimeOn] = useState("")
  const [timeOff, setTimeOff] = useState("")
  const [notes, setNotes] = useState("")

  const tankCapacityGal = useMemo(
    () => equipment.find((eq) => eq.id === equipmentId)?.tank_capacity_gal ?? null,
    [equipment, equipmentId],
  )

  // The "% of tank" option only makes sense once the selected machine has a
  // known tank capacity; fall back to gallons if it stops being available
  // (e.g. the user switches to a machine with no capacity on file).
  const handleEquipmentChange = (nextEquipmentId: string) => {
    setEquipmentId(nextEquipmentId)
    const nextCapacity =
      equipment.find((eq) => eq.id === nextEquipmentId)?.tank_capacity_gal ?? null
    if (waterUnit === "pct" && nextCapacity === null) {
      setWaterUnit("gal")
      setWaterUsed("")
    }
  }

  const handleWaterUnitChange = (nextUnit: WaterUsageUnit) => {
    setWaterUsed((prev) =>
      convertWaterDisplay(prev, waterUnit, nextUnit, tankCapacityGal),
    )
    setWaterUnit(nextUnit)
  }

  const canonicalWaterGal = useMemo(() => {
    if (waterUsed.trim() === "") return ""
    const n = Number(waterUsed)
    if (!Number.isFinite(n)) return ""
    const gal =
      waterUnit === "gal"
        ? n
        : waterUnit === "L"
          ? lToGal(n)
          : pctToGal(n, tankCapacityGal)
    return gal === null ? "" : String(roundVolume(gal))
  }, [waterUsed, waterUnit, tankCapacityGal])

  const { queued, handleSubmit } = useOfflineSubmit("ice_make", () => ({
    rink_id: rinkId || null,
    equipment_id: equipmentId || null,
    occurred_at: occurredAt,
    notes: notes.trim() || null,
    water_used_gal: canonicalWaterGal,
    machine_hours: machineHours,
    snow_taken_pct: snowTaken,
    time_in: timeOn,
    time_out: timeOff,
  }))

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  if (queued) return <OfflineQueuedCard />

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <FormError message={state.error} />

      <input type="hidden" name="occurred_at" value={occurredAt} />
      <input type="hidden" name="rink_id" value={rinkId} />
      <input type="hidden" name="equipment_id" value={equipmentId} />
      <input type="hidden" name="time_in" value={timeOn} />
      <input type="hidden" name="time_out" value={timeOff} />
      <input type="hidden" name="water_used_gal" value={canonicalWaterGal} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>
            Rink
            <RequiredMark />
          </Label>
          <Select value={rinkId} onValueChange={setRinkId} required>
            <SelectTrigger>
              <SelectValue placeholder="Select rink" />
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
          <Label>
            Machine
            <RequiredMark />
          </Label>
          <Select
            value={equipmentId}
            onValueChange={handleEquipmentChange}
            required
          >
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

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="water_used_gal">
              Water Used ({waterUsageUnitLabel(waterUnit)})
            </Label>
            <WaterUnitToggle
              value={waterUnit}
              onChange={handleWaterUnitChange}
              pctDisabled={tankCapacityGal === null}
            />
          </div>
          <Input
            id="water_used_gal"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            max={waterUnit === "pct" ? 100 : undefined}
            placeholder="0.00"
            value={waterUsed}
            onChange={(e) => setWaterUsed(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="machine_hours">Machine Hours</Label>
          <Input
            id="machine_hours"
            name="machine_hours"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="0.00"
            value={machineHours}
            onChange={(e) => setMachineHours(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="snow_taken_pct">Snow Taken (%)</Label>
          <Input
            id="snow_taken_pct"
            name="snow_taken_pct"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            max="100"
            placeholder="0-100"
            value={snowTaken}
            onChange={(e) => setSnowTaken(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="time_on">Time On</Label>
          <Input
            id="time_on"
            type="time"
            value={timeOn}
            onChange={(e) => setTimeOn(e.target.value)}
            className="h-12 text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="time_off">Time Off</Label>
          <Input
            id="time_off"
            type="time"
            value={timeOff}
            onChange={(e) => setTimeOff(e.target.value)}
            className="h-12 text-base"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          placeholder="Add any additional notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-24 text-base"
        />
      </div>

      <SubmitBar />
    </form>
  )
}

const WATER_UNIT_LABELS: Record<WaterUsageUnit, string> = {
  gal: "Gal",
  L: "L",
  pct: "% Tank",
}

function WaterUnitToggle({
  value,
  onChange,
  pctDisabled,
}: {
  value: WaterUsageUnit
  onChange: (unit: WaterUsageUnit) => void
  pctDisabled: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Water usage unit"
      className="inline-flex rounded-md border border-input bg-input-bg p-0.5"
    >
      {WATER_UNITS.map((unit) => {
        const disabled = unit === "pct" && pctDisabled
        const active = value === unit
        return (
          <button
            key={unit}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(unit)}
            className={`rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {WATER_UNIT_LABELS[unit]}
          </button>
        )
      })}
    </div>
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
      {pending ? "Submitting…" : "Submit resurface"}
    </Button>
  )
}
