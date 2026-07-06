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
  tank_capacity_gal?: number | null
}

export type EmployeeOption = {
  id: string
  name: string
}

export function equipmentLabel(eq: EquipmentOption): string {
  if (eq.hours_count === null || eq.hours_count === undefined) {
    return eq.name
  }
  return `${eq.name} — ${eq.hours_count} hrs`
}
