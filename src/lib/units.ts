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
