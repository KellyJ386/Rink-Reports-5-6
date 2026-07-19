"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import {
  MODULE_NAMES,
  USER_ACTIONS,
  isAdminConsoleGrant,
  presetMatrix,
  type ModuleName,
  type Preset,
  type UserAction,
} from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

export type ActionResult = { ok: true } | { ok: false; error: string }

type CellRow = {
  user_id: string
  facility_id: string
  module_name: ModuleName
  action: UserAction
  enabled: boolean
  // Admin grid edits are deliberate exceptions to the role defaults, so they
  // are marked manual_override and never re-seeded by apply_role_permission_defaults.
  source: "manual_override"
}

function isModuleName(value: string): value is ModuleName {
  return (MODULE_NAMES as readonly string[]).includes(value)
}

function isUserAction(value: string): value is UserAction {
  return (USER_ACTIONS as readonly string[]).includes(value)
}

// The `user_permissions` write policy only fences by facility_id — it does NOT
// confirm the target user actually belongs to that facility. Without this
// check a facility admin could write rows for an arbitrary UUID scoped to their
// own facility (data hygiene; the rows are inert since resolution keys off the
// user's home facility). Confirm membership via an active employee row — the
// unit of facility membership in this app, and one a facility admin can read
// under RLS. Super admins skip this (they legitimately grant across facilities).
async function isFacilityMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  facilityId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", userId)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  return data !== null
}

// `isAdminConsoleGrant` (the admin/admin escalation guard) is shared from
// @/lib/permissions so every write path into user_permissions /
// role_permission_defaults enforces the same "only a super admin can mint a
// facility admin" rule.

/**
 * Upsert a single permission cell for one (user, facility, module, action).
 * The unique constraint user_permissions_unique drives the upsert.
 */
export async function upsertUserPermission(input: {
  userId: string
  facilityId: string
  moduleName: string
  action: string
  enabled: boolean
}): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin()
    if (!isModuleName(input.moduleName)) {
      return { ok: false, error: `Invalid module: ${input.moduleName}` }
    }
    if (!isUserAction(input.action)) {
      return { ok: false, error: `Invalid action: ${input.action}` }
    }

    const isSuperAdmin = profile?.is_super_admin ?? false
    const supabase = await createClient()
    if (!isSuperAdmin) {
      // Defense-in-depth: a facility admin may only manage permissions within
      // their own facility, and may never grant Admin Center access.
      if (input.facilityId !== profile?.facility_id) {
        return { ok: false, error: "You can only manage permissions within your own facility." }
      }
      if (input.enabled && isAdminConsoleGrant(input.moduleName, input.action)) {
        return { ok: false, error: "Only a super admin can grant Admin Center access." }
      }
      if (!(await isFacilityMember(supabase, input.userId, input.facilityId))) {
        return { ok: false, error: "That user is not an active member of this facility." }
      }
    }

    const { error } = await supabase
      .from("user_permissions")
      .upsert(
        {
          user_id: input.userId,
          facility_id: input.facilityId,
          module_name: input.moduleName,
          action: input.action,
          enabled: input.enabled,
          source: "manual_override",
        },
        { onConflict: "user_id,facility_id,module_name,action" },
      )

    if (error) return { ok: false, error: error.message }

    revalidatePath("/admin/permissions")
    revalidatePath(`/admin/permissions/${input.userId}`)
    return { ok: true }
  } catch (e) {
    logServerError("admin/permissions/user-permission-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Apply one of the built-in presets to the entire matrix for a single user.
 * Writes one row per (module, action) — 40 rows total per call.
 */
export async function applyPresetToUser(input: {
  userId: string
  facilityId: string
  preset: Preset
}): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin()
    const isSuperAdmin = profile?.is_super_admin ?? false
    const supabase = await createClient()
    if (!isSuperAdmin) {
      if (input.facilityId !== profile?.facility_id) {
        return { ok: false, error: "You can only manage permissions within your own facility." }
      }
      if (!(await isFacilityMember(supabase, input.userId, input.facilityId))) {
        return { ok: false, error: "That user is not an active member of this facility." }
      }
    }

    const matrix = presetMatrix(input.preset)

    const rows: CellRow[] = []
    for (const m of MODULE_NAMES) {
      for (const a of USER_ACTIONS) {
        // A non-super-admin can apply a broad preset but can never grant Admin
        // Center access through it (the full_access preset would otherwise set
        // admin/admin = true).
        const enabled =
          !isSuperAdmin && isAdminConsoleGrant(m, a) ? false : matrix[m][a]
        rows.push({
          user_id: input.userId,
          facility_id: input.facilityId,
          module_name: m,
          action: a,
          enabled,
          source: "manual_override",
        })
      }
    }

    const { error } = await supabase
      .from("user_permissions")
      .upsert(rows, { onConflict: "user_id,facility_id,module_name,action" })

    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/permissions/${input.userId}`)
    return { ok: true }
  } catch (e) {
    logServerError("admin/permissions/user-permission-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

export type BulkImportResult =
  | { ok: true; inserted: number; skipped: number; errors: string[] }
  | { ok: false; error: string }

/**
 * Bulk import via CSV. Expected header (case-insensitive, any order):
 *   user_id, facility_id, module, action, enabled
 *
 * `enabled` accepts: true/false/1/0/yes/no. Rows with unknown
 * module/action or non-uuid ids are skipped and reported in `errors`.
 */
export async function bulkImportUserPermissionsCsv(
  csv: string,
): Promise<BulkImportResult> {
  try {
    const { profile } = await requireAdmin()
    const isSuperAdmin = profile?.is_super_admin ?? false
    const supabase = await createClient()

    const parsed = parseCsv(csv)
    if (!parsed.ok) return { ok: false, error: parsed.error }

    // For a non-super-admin importer, preload the set of active employee
    // user_ids in their facility once (rather than one query per row) so we can
    // reject grants aimed at users who aren't members of the facility.
    let facilityMemberIds: Set<string> | null = null
    if (!isSuperAdmin && profile?.facility_id) {
      const { data: members } = await supabase
        .from("employees")
        .select("user_id")
        .eq("facility_id", profile.facility_id)
        .eq("is_active", true)
      facilityMemberIds = new Set(
        (members ?? [])
          .map((m) => m.user_id)
          .filter((id): id is string => Boolean(id)),
      )
    }

    const rows: CellRow[] = []
    const errors: string[] = []
    let skipped = 0

    parsed.rows.forEach((row, idx) => {
      const lineNo = idx + 2 // header is line 1
      const userId = row.user_id?.trim()
      const facilityId = row.facility_id?.trim()
      const moduleName = row.module?.trim()
      const action = row.action?.trim()
      const enabledRaw = row.enabled?.trim().toLowerCase() ?? ""

      if (!userId || !facilityId || !moduleName || !action) {
        skipped++
        errors.push(`Line ${lineNo}: missing required column`)
        return
      }
      if (!isModuleName(moduleName)) {
        skipped++
        errors.push(`Line ${lineNo}: invalid module "${moduleName}"`)
        return
      }
      if (!isUserAction(action)) {
        skipped++
        errors.push(`Line ${lineNo}: invalid action "${action}"`)
        return
      }
      // A blank `enabled` cell must never default to granting access — require
      // an explicit, recognized value.
      if (!enabledRaw) {
        skipped++
        errors.push(`Line ${lineNo}: missing required column`)
        return
      }
      if (!["true", "false", "1", "0", "yes", "no"].includes(enabledRaw)) {
        skipped++
        errors.push(`Line ${lineNo}: invalid enabled "${row.enabled}"`)
        return
      }
      const enabled =
        enabledRaw === "true" || enabledRaw === "1" || enabledRaw === "yes"

      // Non-super-admins can't escape the matrix guards via CSV: skip rows
      // outside their facility or any row that would grant Admin Center access.
      if (!isSuperAdmin) {
        if (facilityId !== profile?.facility_id) {
          skipped++
          errors.push(`Line ${lineNo}: facility outside your scope`)
          return
        }
        if (enabled && isAdminConsoleGrant(moduleName, action)) {
          skipped++
          errors.push(`Line ${lineNo}: only a super admin can grant Admin Center access`)
          return
        }
        if (facilityMemberIds && !facilityMemberIds.has(userId)) {
          skipped++
          errors.push(`Line ${lineNo}: user is not an active member of this facility`)
          return
        }
      }

      rows.push({
        user_id: userId,
        facility_id: facilityId,
        module_name: moduleName,
        action,
        enabled,
        source: "manual_override",
      })
    })

    let inserted = 0
    if (rows.length > 0) {
      const { error, count } = await supabase
        .from("user_permissions")
        .upsert(rows, {
          onConflict: "user_id,facility_id,module_name,action",
          count: "exact",
        })
      if (error) return { ok: false, error: error.message }
      inserted = count ?? rows.length
    }

    revalidatePath("/admin/permissions")
    return { ok: true, inserted, skipped, errors }
  } catch (e) {
    logServerError("admin/permissions/user-permission-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Minimal RFC-4180-ish CSV parser. Handles double-quoted fields, escaped
 * quotes (""), embedded commas and newlines. Returns rows keyed by header.
 */
function parseCsv(
  source: string,
): { ok: true; rows: Record<string, string>[] } | { ok: false; error: string } {
  const trimmed = source.replace(/^﻿/, "").trim()
  if (!trimmed) return { ok: true, rows: [] }

  const cells: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inQuotes) {
      if (ch === '"') {
        if (trimmed[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && trimmed[i + 1] === "\n") i++
      row.push(field)
      cells.push(row)
      row = []
      field = ""
    } else {
      field += ch
    }
  }
  row.push(field)
  cells.push(row)

  if (cells.length === 0) return { ok: true, rows: [] }
  const header = cells[0].map((h) => h.trim().toLowerCase())
  const required = ["user_id", "facility_id", "module", "action", "enabled"]
  for (const col of required) {
    if (!header.includes(col)) {
      return { ok: false, error: `CSV missing required column "${col}"` }
    }
  }

  const rows: Record<string, string>[] = []
  for (let r = 1; r < cells.length; r++) {
    const line = cells[r]
    if (line.length === 1 && line[0] === "") continue
    const rec: Record<string, string> = {}
    header.forEach((h, i) => {
      rec[h] = line[i] ?? ""
    })
    rows.push(rec)
  }
  return { ok: true, rows }
}
