import type { EquipmentType } from "../../types"

export type RinkOption = {
  id: string
  name: string
}

export type EquipmentOption = {
  id: string
  name: string
  equipment_type: EquipmentType
  hours_count: number | null
  fuel_type_id?: string | null
}

export type EmployeeOption = {
  id: string
  name: string
}

/**
 * Build a default value for a `datetime-local` input from "now". The input
 * expects `YYYY-MM-DDTHH:mm` in the user's local time, so we manually format
 * rather than using `toISOString()` (which is UTC).
 */
export function nowForDateTimeLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function equipmentLabel(eq: EquipmentOption): string {
  if (eq.hours_count === null || eq.hours_count === undefined) {
    return eq.name
  }
  return `${eq.name} — ${eq.hours_count} hrs`
}
