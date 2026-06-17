// Local types for the shared Facility Spaces admin module.
// `facility_spaces` is a shared, facility-wide list of physical areas consumed
// by Incident Reports, Accident Reports, and Air Quality. Managed here.

import type { Tables } from "@/types/database"

export type FacilitySpaceRow = Tables<"facility_spaces">

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

export type BulkImportResult =
  | { ok: true; inserted: number; skipped: number; errors: string[] }
  | { ok: false; error: string }
