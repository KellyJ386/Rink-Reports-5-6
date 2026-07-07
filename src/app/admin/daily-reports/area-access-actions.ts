"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { logServerError } from "@/lib/observability/log-server-error"

import type { SimpleResult } from "./types"

const MODULE_KEY = "daily_reports"

/**
 * Same guard as actions.ts: the module-scoped admin grant is what RLS
 * enforces on these writes; requireAdmin alone does not imply it.
 */
async function ensureDailyAdmin(): Promise<string | null> {
  await requireAdmin()
  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "daily_reports", "admin")
  return allowed
    ? null
    : "Your account has admin console access but not the daily reports module's admin permission. Ask an administrator to grant it under Admin → Permissions."
}

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  return { ok: true, facilityId: profile.facility_id }
}

/**
 * Grant or revoke daily-report submit access for one (employee, area).
 * A grant writes can_view + can_submit (submit without view is meaningless);
 * a revoke deletes the row. The DB layer (migration 89) is the real boundary —
 * this just maintains the rows it reads.
 */
export async function setDailyAreaAccess(input: {
  employeeId: string
  areaId: string
  enabled: boolean
}): Promise<SimpleResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const supabase = await createClient()

    // Confirm both the employee and the area belong to the admin's facility so
    // a crafted id can't grant access across facilities.
    const [{ data: emp }, { data: area }] = await Promise.all([
      supabase
        .from("employees")
        .select("id")
        .eq("id", input.employeeId)
        .eq("facility_id", facility.facilityId)
        .maybeSingle(),
      supabase
        .from("daily_report_areas")
        .select("id")
        .eq("id", input.areaId)
        .eq("facility_id", facility.facilityId)
        .maybeSingle(),
    ])
    if (!emp) return { ok: false, error: "Employee not in your facility." }
    if (!area) return { ok: false, error: "Area not in your facility." }

    if (input.enabled) {
      const { error } = await supabase.from("module_area_permissions").upsert(
        {
          facility_id: facility.facilityId,
          employee_id: input.employeeId,
          module_key: MODULE_KEY,
          area_id: input.areaId,
          can_view: true,
          can_submit: true,
        },
        { onConflict: "employee_id,module_key,area_id" },
      )
      if (error) return { ok: false, error: error.message }
    } else {
      const { error } = await supabase
        .from("module_area_permissions")
        .delete()
        .eq("employee_id", input.employeeId)
        .eq("module_key", MODULE_KEY)
        .eq("area_id", input.areaId)
      if (error) return { ok: false, error: error.message }
    }

    revalidatePath("/admin/daily-reports")
    return { ok: true }
  } catch (e) {
    logServerError("admin/daily-reports/area-access-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

export type BulkAreaAccessResult =
  | {
      ok: true
      granted: number
      revoked: number
      skipped: number
      errors: string[]
    }
  | { ok: false; error: string }

/**
 * Bulk import daily area access from CSV. Header (case-insensitive, any order):
 *   email, area, can_submit
 * `area` matches a daily area slug or name (case-insensitive). Unknown emails
 * or areas are reported in `errors`, never silently dropped.
 */
export async function bulkImportDailyAreaAccessCsv(
  csv: string,
): Promise<BulkAreaAccessResult> {
  try {
    const denied = await ensureDailyAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const supabase = await createClient()

    const parsed = parseCsv(csv)
    if (!parsed.ok) return { ok: false, error: parsed.error }

    // Resolve facility employees (by email) and areas (by slug or name).
    const [{ data: emps }, { data: areas }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, email")
        .eq("facility_id", facility.facilityId),
      supabase
        .from("daily_report_areas")
        .select("id, slug, name")
        .eq("facility_id", facility.facilityId),
    ])
    const empByEmail = new Map(
      (emps ?? [])
        .filter((e): e is { id: string; email: string } => !!e.email)
        .map((e) => [e.email.trim().toLowerCase(), e.id]),
    )
    const areaByKey = new Map<string, string>()
    for (const a of areas ?? []) {
      areaByKey.set(a.slug.toLowerCase(), a.id)
      areaByKey.set(a.name.trim().toLowerCase(), a.id)
    }

    const toGrant: Array<{ employeeId: string; areaId: string }> = []
    const toRevoke: Array<{ employeeId: string; areaId: string }> = []
    const errors: string[] = []
    let skipped = 0

    parsed.rows.forEach((row, idx) => {
      const lineNo = idx + 2
      const email = row.email?.trim().toLowerCase() ?? ""
      const areaKey = row.area?.trim().toLowerCase() ?? ""
      const submitRaw = row.can_submit?.trim().toLowerCase() ?? ""

      if (!email || !areaKey) {
        skipped++
        errors.push(`Line ${lineNo}: missing email or area`)
        return
      }
      const employeeId = empByEmail.get(email)
      if (!employeeId) {
        skipped++
        errors.push(`Line ${lineNo}: unknown email "${row.email}"`)
        return
      }
      const areaId = areaByKey.get(areaKey)
      if (!areaId) {
        skipped++
        errors.push(`Line ${lineNo}: unknown area "${row.area}"`)
        return
      }
      if (!["true", "false", "1", "0", "yes", "no"].includes(submitRaw)) {
        skipped++
        errors.push(`Line ${lineNo}: invalid can_submit "${row.can_submit}"`)
        return
      }
      const enabled = submitRaw === "true" || submitRaw === "1" || submitRaw === "yes"
      if (enabled) toGrant.push({ employeeId, areaId })
      else toRevoke.push({ employeeId, areaId })
    })

    let granted = 0
    if (toGrant.length > 0) {
      const { error } = await supabase.from("module_area_permissions").upsert(
        toGrant.map((g) => ({
          facility_id: facility.facilityId,
          employee_id: g.employeeId,
          module_key: MODULE_KEY,
          area_id: g.areaId,
          can_view: true,
          can_submit: true,
        })),
        { onConflict: "employee_id,module_key,area_id" },
      )
      if (error) return { ok: false, error: error.message }
      granted = toGrant.length
    }

    let revoked = 0
    for (const r of toRevoke) {
      const { error } = await supabase
        .from("module_area_permissions")
        .delete()
        .eq("employee_id", r.employeeId)
        .eq("module_key", MODULE_KEY)
        .eq("area_id", r.areaId)
      if (error) return { ok: false, error: error.message }
      revoked++
    }

    revalidatePath("/admin/daily-reports")
    return { ok: true, granted, revoked, skipped, errors }
  } catch (e) {
    logServerError("admin/daily-reports/area-access-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Minimal RFC-4180-ish CSV parser (mirrors the permissions importer): handles
 * quoted fields, escaped quotes, embedded commas/newlines. Keyed by header.
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

  const header = cells[0].map((h) => h.trim().toLowerCase())
  for (const col of ["email", "area", "can_submit"]) {
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
