export type TempUnit = "F" | "C"

const TEMP_UNIT_RE = /^\s*°?\s*([FC])\s*$/i

export function isTempUnit(unit: string | null | undefined): boolean {
  return typeof unit === "string" && TEMP_UNIT_RE.test(unit)
}

export function fToC(f: number): number {
  return ((f - 32) * 5) / 9
}

export function cToF(c: number): number {
  return (c * 9) / 5 + 32
}

export function roundTemp(value: number): number {
  return Math.round(value * 10) / 10
}

export function tempUnitLabel(unit: TempUnit): string {
  return unit === "C" ? "°C" : "°F"
}

/** Water-usage display unit: canonical storage is always gallons. */
export type WaterUsageUnit = "gal" | "L" | "pct"

const GALLONS_PER_LITER = 1 / 3.785411784

export function galToL(gal: number): number {
  return gal / GALLONS_PER_LITER
}

export function lToGal(liters: number): number {
  return liters * GALLONS_PER_LITER
}

/** Gallons used as a percentage of the machine's tank capacity, else null. */
export function galToPct(
  gal: number,
  tankCapacityGal: number | null,
): number | null {
  if (!tankCapacityGal || tankCapacityGal <= 0) return null
  return (gal / tankCapacityGal) * 100
}

export function pctToGal(
  pct: number,
  tankCapacityGal: number | null,
): number | null {
  if (!tankCapacityGal || tankCapacityGal <= 0) return null
  return (pct / 100) * tankCapacityGal
}

export function roundVolume(value: number): number {
  return Math.round(value * 100) / 100
}

export function waterUsageUnitLabel(unit: WaterUsageUnit): string {
  if (unit === "L") return "L"
  if (unit === "pct") return "% of tank"
  return "gal"
}
