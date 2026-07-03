// Resolve-or-create against the per-facility certification catalog
// (certification_types, migration 169). Plain module — callers pass their own
// RLS-scoped Supabase client; the catalog's write policy already gates who
// may create types (scheduling admins + role admins).

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database"

type AnyClient = SupabaseClient<Database>

export type ResolvedCertType =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string }

/**
 * Find the facility's certification type matching `name`
 * (case-insensitively, trimmed) or create it. Returns the catalog id and the
 * CANONICAL name (first-created casing), so callers can store the canonical
 * spelling. Handles the create race via the CI-unique index (23505 →
 * re-select).
 */
export async function resolveCertificationType(
  supabase: AnyClient,
  facilityId: string,
  name: string
): Promise<ResolvedCertType> {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 200) {
    return { ok: false, error: "Certification name must be 1–200 characters." }
  }

  // ilike treats % _ \ as pattern characters — escape them so a literal
  // name like "100% Attendance" matches exactly.
  const pattern = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)
  const find = async (): Promise<{ id: string; name: string } | null> => {
    const { data } = await supabase
      .from("certification_types")
      .select("id, name")
      .eq("facility_id", facilityId)
      .ilike("name", pattern)
      .limit(1)
      .maybeSingle<{ id: string; name: string }>()
    return data ?? null
  }

  const existing = await find()
  if (existing) return { ok: true, ...existing }

  const { data: created, error } = await supabase
    .from("certification_types")
    .insert({ facility_id: facilityId, name: trimmed })
    .select("id, name")
    .maybeSingle<{ id: string; name: string }>()
  if (!error && created) return { ok: true, ...created }

  // Unique-index race: someone created it between our select and insert.
  if (error?.code === "23505") {
    const after = await find()
    if (after) return { ok: true, ...after }
  }
  return {
    ok: false,
    error: error?.message ?? "Failed to save the certification type.",
  }
}
