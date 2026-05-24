// Compatibility shim. The legacy types lived here before migration 77 swapped
// the source of truth to `public.user_permissions`. The canonical module list
// now lives in @/lib/permissions; this file re-exports the same identifiers
// under their old names so the existing admin/employees and admin/roles pages
// continue to compile until they're migrated to the new system.

import type { PermissionLevel } from "@/lib/permissions"
import {
  MODULE_NAMES,
  MODULE_LABELS as USER_MODULE_LABELS,
  type ModuleName,
} from "@/lib/permissions"

export const MODULE_KEYS = MODULE_NAMES
export type ModuleKey = ModuleName

export const MODULE_LABELS: Record<ModuleKey, string> = USER_MODULE_LABELS

export type Employee = {
  id: string
  full_name: string
  email: string | null
  role_key: string | null
  role_display_name: string | null
  departments: string[]
}

export type ModulePermissionMap = Record<
  string,
  Partial<Record<ModuleKey, PermissionLevel>>
>
