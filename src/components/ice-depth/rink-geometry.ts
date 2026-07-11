// Pure geometry helpers + chip types used by the USA Hockey rink diagram.
// Lives in a non-"use client" module so server components (eg the ice-depth
// /done page) can import these without crossing a client boundary.

export const RINK_W = 380
export const RINK_H = 740

/** Map stored 0..1 fractions to viewBox pixel coordinates. */
export function rinkCoords(xPosition: number, yPosition: number) {
  return { cx: xPosition * RINK_W, cy: yPosition * RINK_H }
}

export type PointChipState = "pending" | "current" | "done" | "inactive"

export interface RinkPointSpec {
  id: string
  pointNumber: number
  cx: number
  cy: number
  state: PointChipState
  /** Hex color used when state === 'done'. */
  doneColor?: string
  /**
   * Optional severity of the measured value. Drives a non-color shape cue
   * (▲ above target / ▼ below min) on the chip so out-of-range points are
   * distinguishable without relying on color alone (WCAG 1.4.1).
   */
  severity?: "ok" | "low" | "high" | null
  /** Optional depth label shown inside done chips when showValues=true. */
  depthValue?: number | null
  onClick?: () => void
}
