// Local types for the Departments admin module.
// The 1:1 row type is re-exported from the generated Supabase types.

import type { Tables } from "@/types/database"

export type DepartmentRow = Tables<"departments">

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
