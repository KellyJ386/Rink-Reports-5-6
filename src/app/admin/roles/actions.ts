"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { PERMISSION_LEVELS, type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS, type ModuleKey } from "../permissions/types"

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

export async function setRoleModulePermissionLevel(
  roleId: string,
  moduleKey: string,
  level: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidLevel(level)
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()

    const { data: role, error: roleErr } = await supabase
      .from("roles")
      .select("id, facility_id")
      .eq("id", roleId)
      .maybeSingle()

    if (roleErr) return { ok: false, error: roleErr.message }
    if (!role) return { ok: false, error: "Role not found" }

    // role_module_permission_defaults isn't in generated types yet; cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { error: upErr } = await sb
      .from("role_module_permission_defaults")
      .upsert(
        {
          facility_id: role.facility_id,
          role_id: roleId,
          module_key: moduleKey,
          permission_level: level,
        },
        { onConflict: "role_id,module_key" },
      )

    if (upErr) return { ok: false, error: upErr.message }

    revalidatePath("/admin/roles")
    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return { ok: false, error: msg }
  }
}
