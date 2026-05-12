export const PERMISSION_LEVELS = [
  "none",
  "view",
  "submit",
  "edit_own",
  "edit_all",
  "approve",
  "publish",
  "manage_settings",
  "admin",
] as const

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: "No access",
  view: "View only",
  submit: "Submit",
  edit_own: "Edit own",
  edit_all: "Edit all",
  approve: "Approve",
  publish: "Publish",
  manage_settings: "Manage settings",
  admin: "Admin",
}

export const PERMISSION_LEVEL_DESCRIPTIONS: Record<PermissionLevel, string> = {
  none: "Module is hidden. Direct URL returns 403.",
  view: "Can see records but not create or edit.",
  submit: "Can create new records.",
  edit_own: "Can edit records they created.",
  edit_all: "Can edit any record in the facility.",
  approve: "Can approve submitted records (swap requests, time-off, etc.).",
  publish: "Can publish records visible to staff (e.g. schedules).",
  manage_settings: "Can configure this module's admin settings page.",
  admin: "Full control including permission changes for other employees.",
}

export function levelRank(level: PermissionLevel): number {
  return PERMISSION_LEVELS.indexOf(level)
}

export function levelGte(a: PermissionLevel, b: PermissionLevel): boolean {
  return levelRank(a) >= levelRank(b)
}

export function flagsFromLevel(level: PermissionLevel): {
  can_view: boolean
  can_submit: boolean
  can_admin: boolean
} {
  return {
    can_view: level !== "none" && levelGte(level, "view"),
    can_submit: levelGte(level, "submit"),
    can_admin: levelGte(level, "manage_settings"),
  }
}

export function levelFromFlags(flags: {
  can_view: boolean
  can_submit: boolean
  can_admin: boolean
}): PermissionLevel {
  if (flags.can_admin) return "admin"
  if (flags.can_submit) return "submit"
  if (flags.can_view) return "view"
  return "none"
}
