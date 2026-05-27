"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import {
  MODULE_NAMES,
  USER_ACTIONS,
  presetMatrix,
  type ModuleName,
  type Preset,
  type UserAction,
} from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

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
    await requireAdmin()
    if (!isModuleName(input.moduleName)) {
      return { ok: false, error: `Invalid module: ${input.moduleName}` }
    }
    if (!isUserAction(input.action)) {
      return { ok: false, error: `Invalid action: ${input.action}` }
    }

    const supabase = await createClient()
    const { error } = await supabase
      // user_permissions isn't in generated types yet; cast follows
      // the project pattern (see src/app/api/offline-sync/route.ts).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("user_permissions" as any)
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
    await requireAdmin()
    const supabase = await createClient()
    const matrix = presetMatrix(input.preset)

    const rows: CellRow[] = []
    for (const m of MODULE_NAMES) {
      for (const a of USER_ACTIONS) {
        rows.push({
          user_id: input.userId,
          facility_id: input.facilityId,
          module_name: m,
          action: a,
          enabled: matrix[m][a],
          source: "manual_override",
        })
      }
    }

    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("user_permissions" as any)
      .upsert(rows, { onConflict: "user_id,facility_id,module_name,action" })

    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/permissions/${input.userId}`)
    return { ok: true }
  } catch (e) {
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
    await requireAdmin()
    const supabase = await createClient()

    const parsed = parseCsv(csv)
    if (!parsed.ok) return { ok: false, error: parsed.error }

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("user_permissions" as any)
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
