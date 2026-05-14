import { type PermissionLevel } from "./levels"

export type PermissionSource =
  | "super_admin"
  | "override"
  | "role"
  | "none"

export type EffectivePermission = {
  level: PermissionLevel
  source: PermissionSource
}
