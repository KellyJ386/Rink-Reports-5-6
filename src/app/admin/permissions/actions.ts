"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { PERMISSION_LEVELS, type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS, type ModuleKey } from "./types"

function assertValidLevel(level: string): asserts level is PermissionLevel {
  if (!(PERMISSION_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`Invalid permission level: ${level}`)
  }
}

function assertValidModuleKey(key: string): asserts key is ModuleKey {
  if (!(MODULE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Invalid module key: ${key}`)
  }
}

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function setModulePermissionLevel(
  employeeId: string,
  moduleKey: string,
  level: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidLevel(level)
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()

    // Defensive read so RLS rejects callers from other tenants.
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    const { data: existing, error: selErr } = await supabase
      .from("module_permissions")
      .select("id")
      .eq("employee_id", employeeId)
      .eq("module_key", moduleKey)
      .maybeSingle()

    if (selErr) return { ok: false, error: selErr.message }

    // permission_level isn't in generated types yet; cast the client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    if (existing) {
      const { error: updErr } = await sb
        .from("module_permissions")
        .update({ permission_level: level })
        .eq("id", existing.id)
        .eq("facility_id", employee.facility_id)

      if (updErr) return { ok: false, error: updErr.message }
    } else {
      const { error: insErr } = await sb.from("module_permissions").insert({
        facility_id: employee.facility_id,
        employee_id: employeeId,
        module_key: moduleKey,
        permission_level: level,
      })

      if (insErr) return { ok: false, error: insErr.message }
    }

    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return { ok: false, error: msg }
  }
}
