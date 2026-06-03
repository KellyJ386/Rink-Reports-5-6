// Pure validation + spreadsheet-parsing helpers for the bulk-add grid.
//
// Deliberately framework-free (no "use client" / "server-only") so the
// SAME rules run client-side for instant feedback AND server-side as the
// authoritative gate. Never trust the client copy alone.

import type { RoleRow } from "../../types"
import type { BulkRow, RowErrors } from "../types"

// Pragmatic email shape check. Mirrors what `<input type="email">` accepts
// closely enough for a roster import; the real source of truth is delivery.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

/** A row is "blank" when the user hasn't touched any field. Blank rows are
 *  ignored entirely — neither validated nor submitted. */
export function isRowBlank(row: BulkRow): boolean {
  return (
    !row.firstName.trim() &&
    !row.lastName.trim() &&
    !row.email.trim() &&
    !row.hireDate.trim() &&
    !row.roleId
  )
}

/** Normalize loose date input (`yyyy-mm-dd` or `m/d/yyyy`) to ISO `yyyy-mm-dd`.
 *  Returns null when the value isn't a real calendar date. */
export function normalizeHireDate(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (iso) {
    y = Number(iso[1])
    m = Number(iso[2])
    d = Number(iso[3])
  } else if (us) {
    m = Number(us[1])
    d = Number(us[2])
    y = Number(us[3])
  } else {
    return null
  }

  // Round-trip through Date to reject impossible dates (e.g. 2026-02-31).
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null
  }
  const mm = String(m).padStart(2, "0")
  const dd = String(d).padStart(2, "0")
  return `${y}-${mm}-${dd}`
}

export type ValidateContext = {
  /** Valid role ids for this facility. */
  roleIds: Set<string>
  /** Lowercased emails of employees that already exist in the facility. */
  existingEmails: Set<string>
  /** email(lowercased) -> how many non-blank rows in this batch use it. */
  batchEmailCounts: Map<string, number>
}

/** Build the per-batch email-count map used for in-batch duplicate detection. */
export function buildBatchEmailCounts(rows: BulkRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (isRowBlank(row)) continue
    const email = row.email.trim().toLowerCase()
    if (!email) continue
    counts.set(email, (counts.get(email) ?? 0) + 1)
  }
  return counts
}

/** Validate one non-blank row. Returns an empty object when the row is clean. */
export function validateRow(row: BulkRow, ctx: ValidateContext): RowErrors {
  const errors: RowErrors = {}

  if (!row.firstName.trim()) errors.firstName = "Required"
  else if (row.firstName.trim().length > 100) errors.firstName = "Too long"

  if (!row.lastName.trim()) errors.lastName = "Required"
  else if (row.lastName.trim().length > 100) errors.lastName = "Too long"

  const email = row.email.trim()
  if (!email) {
    errors.email = "Required"
  } else if (email.length > 254) {
    errors.email = "Too long"
  } else if (!isValidEmail(email)) {
    errors.email = "Invalid email"
  } else {
    const lower = email.toLowerCase()
    if (ctx.existingEmails.has(lower)) {
      errors.email = "Already an employee"
    } else if ((ctx.batchEmailCounts.get(lower) ?? 0) > 1) {
      errors.email = "Duplicate in list"
    }
  }

  if (!row.hireDate.trim()) {
    errors.hireDate = "Required"
  } else if (!normalizeHireDate(row.hireDate)) {
    errors.hireDate = "Invalid date"
  }

  if (!row.roleId) errors.roleId = "Required"
  else if (!ctx.roleIds.has(row.roleId)) errors.roleId = "Unknown role"

  return errors
}

/** Validate every non-blank row. Keyed by row id; clean rows are omitted. */
export function validateRows(
  rows: BulkRow[],
  ctx: ValidateContext
): Map<string, RowErrors> {
  const map = new Map<string, RowErrors>()
  for (const row of rows) {
    if (isRowBlank(row)) continue
    const errors = validateRow(row, ctx)
    if (Object.keys(errors).length > 0) map.set(row.id, errors)
  }
  return map
}

let pasteRowSeq = 0
function pasteRowId(): string {
  pasteRowSeq += 1
  return `paste-${Date.now().toString(36)}-${pasteRowSeq}`
}

// Cells (lowercased) that mark the first line as a spreadsheet header rather
// than data — so pasting straight from the downloadable template (which keeps
// its header row) doesn't turn "First name / Email / …" into a bad employee.
const HEADER_CELLS = new Set([
  "first name",
  "last name",
  "first",
  "last",
  "name",
  "email",
  "e-mail",
  "hire date",
  "start date",
  "role",
])

function splitCells(line: string): string[] {
  return (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) =>
    c.trim()
  )
}

function looksLikeHeader(cells: string[]): boolean {
  const matches = cells.filter((c) => HEADER_CELLS.has(c.toLowerCase())).length
  return matches >= 2
}

/**
 * Parse spreadsheet-pasted text into rows. Expected column order matches the
 * grid: First name, Last name, Email, Hire date, Role. Cells may be tab- or
 * comma-separated; the role cell is matched against each role's display name
 * or key (case-insensitive) and resolved to its id when possible. A leading
 * header row (e.g. from the CSV template) is detected and skipped.
 */
export function parsePastedRows(text: string, roles: RoleRow[]): BulkRow[] {
  const roleLookup = new Map<string, string>()
  for (const r of roles) {
    roleLookup.set(r.display_name.trim().toLowerCase(), r.id)
    roleLookup.set(r.key.trim().toLowerCase(), r.id)
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const out: BulkRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCells(lines[i])
    // Skip a header row only if it's the first non-blank line.
    if (i === 0 && looksLikeHeader(cells)) continue
    const [firstName = "", lastName = "", email = "", hireRaw = "", roleRaw = ""] =
      cells
    const normalizedDate = normalizeHireDate(hireRaw)
    out.push({
      id: pasteRowId(),
      firstName,
      lastName,
      email,
      hireDate: normalizedDate ?? hireRaw,
      roleId: roleLookup.get(roleRaw.toLowerCase()) ?? "",
    })
  }
  return out
}
