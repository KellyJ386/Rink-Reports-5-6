export {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_LABELS,
  PERMISSION_LEVEL_DESCRIPTIONS,
  flagsFromLevel,
  levelFromFlags,
  levelGte,
  levelRank,
  type PermissionLevel,
} from "./levels"

export {
  USER_ACTIONS,
  USER_ACTION_LABELS,
  USER_ACTION_DESCRIPTIONS,
  MODULE_NAMES,
  MODULE_LABELS,
  emptyMatrix,
  isAdminConsoleGrant,
  matrixFromRows,
  presetMatrix,
  type UserAction,
  type ModuleName,
  type UserPermissionRow,
  type PermissionMatrix,
  type Preset,
} from "./actions"

// Server-only resolver helpers live in "./effective". Import them directly
// from @/lib/permissions/effective in server components / actions.
export type {
  EffectivePermission,
  PermissionSource,
} from "./types"
