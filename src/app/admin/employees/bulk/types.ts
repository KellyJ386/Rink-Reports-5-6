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
}

/** Per-row outcome returned by the server, indexed against the sent rows. */
export type BulkRowResult = {
  index: number
  ok: boolean
  name: string
  /** Hard failure — the employee was NOT created. */
  error?: string
  /** Soft failure — the employee WAS created, but a follow-up step (invite
   *  / permission seeding) didn't fully succeed. */
  warning?: string
}

/** Overall result of a bulk submit. A top-level `error` means nothing ran
 *  (auth / facility resolution failed); otherwise inspect `results`. */
export type BulkCreateResult =
  | { ok: true; results: BulkRowResult[] }
  | { ok: false; error: string }
