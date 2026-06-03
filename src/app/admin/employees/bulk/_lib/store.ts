"use client"

import { create } from "zustand"

import type { BulkRow, BulkRowResult } from "../types"

let rowSeq = 0
function newRowId(): string {
  rowSeq += 1
  return `row-${Date.now().toString(36)}-${rowSeq}`
}

function emptyRow(roleId = ""): BulkRow {
  return {
    id: newRowId(),
    firstName: "",
    lastName: "",
    email: "",
    hireDate: "",
    roleId,
  }
}

type EditableField = Exclude<keyof BulkRow, "id">

type BulkState = {
  rows: BulkRow[]
  /** Per-row server outcomes from the last submit, keyed by row id. Cleared
   *  whenever the grid is edited so stale badges never linger. */
  results: Record<string, BulkRowResult>

  addRow: () => void
  addRows: (count: number) => void
  appendRows: (rows: BulkRow[]) => void
  updateCell: (id: string, field: EditableField, value: string) => void
  removeRow: (id: string) => void
  clear: () => void
  /** Drop only the rows that succeeded on the last submit, keeping failures
   *  in place so the user can fix and resubmit. */
  removeSucceeded: () => void
  setResults: (results: Record<string, BulkRowResult>) => void
}

const STARTING_ROWS = 3

function makeInitialRows(): BulkRow[] {
  return Array.from({ length: STARTING_ROWS }, () => emptyRow())
}

export const useBulkStore = create<BulkState>((set) => ({
  rows: makeInitialRows(),
  results: {},

  addRow: () => set((s) => ({ rows: [...s.rows, emptyRow()], results: {} })),

  addRows: (count) =>
    set((s) => ({
      rows: [
        ...s.rows,
        ...Array.from({ length: Math.max(0, count) }, () => emptyRow()),
      ],
      results: {},
    })),

  appendRows: (rows) =>
    set((s) => {
      // If the only existing rows are untouched blanks, replace them so a
      // paste doesn't leave empty leading rows.
      const existing = s.rows.every(
        (r) =>
          !r.firstName && !r.lastName && !r.email && !r.hireDate && !r.roleId
      )
        ? []
        : s.rows
      return { rows: [...existing, ...rows], results: {} }
    }),

  updateCell: (id, field, value) =>
    set((s) => ({
      rows: s.rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
      results: {},
    })),

  removeRow: (id) =>
    set((s) => {
      const rows = s.rows.filter((r) => r.id !== id)
      const results = { ...s.results }
      delete results[id]
      return { rows: rows.length > 0 ? rows : makeInitialRows(), results }
    }),

  clear: () => set({ rows: makeInitialRows(), results: {} }),

  removeSucceeded: () =>
    set((s) => {
      const rows = s.rows.filter((r) => !s.results[r.id]?.ok)
      // Keep results only for rows still present (the failures).
      const results: Record<string, BulkRowResult> = {}
      for (const r of rows) {
        if (s.results[r.id]) results[r.id] = s.results[r.id]
      }
      return { rows: rows.length > 0 ? rows : makeInitialRows(), results }
    }),

  setResults: (results) => set({ results }),
}))
