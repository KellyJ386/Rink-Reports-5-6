import { PERMISSION_LEVELS, type PermissionLevel } from "@/lib/permissions"
import { MODULE_KEYS, type ModuleKey } from "./types"

export function assertValidLevel(level: string): asserts level is PermissionLevel {
  if (!(PERMISSION_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`Invalid permission level: ${level}`)
  }
}

export function assertValidModuleKey(key: string): asserts key is ModuleKey {
  if (!(MODULE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Invalid module key: ${key}`)
  }
}
