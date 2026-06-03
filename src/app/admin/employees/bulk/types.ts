// Types for the bulk "Add many employees" flow.
//
// The bulk grid is intentionally narrower than the single-employee form:
// it captures only the four fields the task requires (name, email, hire
// date, role). Everything else (departments, emergency contacts, employee
// code) stays on the single-add form / per-employee edit screen.

/** One editable row in the bulk grid. `id` is a client-only React key. */
export type BulkRow = {
  id: string
  firstName: string
  lastName: string
  email: string
  hireDate: string // yyyy-mm-dd
  roleId: string
}

/** Field-keyed validation errors for a single row. */
export type RowErrors = Partial<
  Record<"firstName" | "lastName" | "email" | "hireDate" | "roleId", string>
>

/** Serializable payload for one employee sent to the server action. */
export type BulkEmployeeInput = {
  firstName: string
  lastName: string
  email: string
  hireDate: string
  roleId: string
  /** Optional job-area ids to assign (max 4). Validated server-side. */
  jobAreaIds?: string[]
  /** Optional id (must be within jobAreaIds) to flag as the primary area. */
  primaryJobAreaId?: string | null
}

/** Outcome bucket for one row. */
export type BulkRowStatus =
  | "succeeded" // employee + areas created cleanly
  | "failed" // nothing persisted (validation / duplicate / foreign area / cap / db)
  | "partial" // employee + areas created, but a soft follow-up (invite/seed) failed

/** Machine-readable reason for a failed/partial row, so the caller can tell
 *  exactly WHY a row didn't import cleanly (no silent drops). */
export type BulkRowReason = {
  code:
    | "VALIDATION" // bad/missing field (name, email, role, hire date)
    | "DUPLICATE" // email / employee_code already exists
    | "FOREIGN_AREA" // a job-area id isn't in this facility
    | "OVER_CAP" // more than 4 job areas
    | "DB_ERROR" // other database failure
    | "INVITE" // login invite / permission seeding failed (partial only)
  message: string
}

/** Per-row outcome returned by the server, indexed against the sent rows. */
export type BulkRowResult = {
  index: number
  name: string
  status: BulkRowStatus
  /** Structured reason for a `failed` or `partial` row. */
  reason?: BulkRowReason
  /** Back-compat convenience: true unless the row `failed`. */
  ok: boolean
  /** Back-compat: set when `failed` (mirrors reason.message). */
  error?: string
  /** Back-compat: set when `partial` (mirrors reason.message). */
  warning?: string
}

/** Overall result of a bulk submit. A top-level `error` means nothing ran
 *  (auth / facility resolution failed); otherwise inspect `results`. */
export type BulkCreateResult =
  | { ok: true; results: BulkRowResult[] }
  | { ok: false; error: string }
