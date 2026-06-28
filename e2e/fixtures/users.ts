import { loadE2EEnv } from "./env"

loadE2EEnv()

/**
 * Role keys for the seven staging test accounts requested for this suite.
 *
 * NOTE on the live permission model (see CLAUDE.md): roles are
 * `super_admin / admin / manager / staff` plus per-facility custom roles
 * (e.g. `driver`). `supervisor` was retired (folded into the permission
 * model). The accounts below — supervisor/icetech/frontdesk/concessions/
 * janitorial — are therefore expected to be seeded in staging as custom
 * facility roles or as `staff` with department-scoped `user_permissions`.
 * Authorization is resolved through `user_permissions`, not a fixed tier.
 */
export type RoleKey =
  | "admin"
  | "manager"
  | "supervisor"
  | "icetech"
  | "frontdesk"
  | "concessions"
  | "janitorial"

export type ModuleKey =
  | "daily_reports"
  | "incident_reports"
  | "accident_reports"
  | "refrigeration"
  | "air_quality"
  | "ice_operations"
  | "ice_depth"
  | "communications"
  | "scheduling"
  | "facility_paperwork"

export interface TestUser {
  role: RoleKey
  /** Default email; override per-deployment with E2E_<ROLE>_EMAIL. */
  email: string
  /** The env var holding this user's password. Never hard-code passwords. */
  passwordEnv: string
  /** Whether this account is an admin-tier user (can reach /admin). */
  isAdmin: boolean
  /** Whether this account can review reports in admin (manager-tier). */
  canReview: boolean
  /**
   * Modules this user's department is expected to have access to. Used by the
   * "employees only see modules assigned to their department" check. These are
   * SEED ASSUMPTIONS — adjust to match your staging seed in e2e/.env.e2e via
   * the role config, or treat mismatches as a finding to reconcile with seed.
   */
  expectedModules: ModuleKey[]
  /** Path the user is expected to land on right after login. */
  expectedLandingPath: string
}

const DEFAULT_DOMAIN = "rinkreports.com"

function emailFor(role: RoleKey, localPart: string): string {
  const override = process.env[`E2E_${role.toUpperCase()}_EMAIL`]
  return override ?? `${localPart}-test@${DEFAULT_DOMAIN}`
}

/**
 * The canonical registry. Everything else in the suite reads from here.
 * All modules are listed for admin/manager (they can see everything);
 * department users get a focused subset (seed assumption — see note above).
 */
export const USERS: Record<RoleKey, TestUser> = {
  admin: {
    role: "admin",
    email: emailFor("admin", "admin"),
    passwordEnv: "E2E_ADMIN_PASSWORD",
    isAdmin: true,
    canReview: true,
    expectedModules: [
      "daily_reports",
      "incident_reports",
      "accident_reports",
      "refrigeration",
      "air_quality",
      "ice_operations",
      "ice_depth",
      "communications",
      "scheduling",
      "facility_paperwork",
    ],
    expectedLandingPath: "/dashboard",
  },
  manager: {
    role: "manager",
    email: emailFor("manager", "manager"),
    passwordEnv: "E2E_MANAGER_PASSWORD",
    isAdmin: false,
    canReview: true,
    expectedModules: [
      "daily_reports",
      "incident_reports",
      "accident_reports",
      "refrigeration",
      "air_quality",
      "ice_operations",
      "ice_depth",
      "communications",
    ],
    expectedLandingPath: "/dashboard",
  },
  supervisor: {
    role: "supervisor",
    email: emailFor("supervisor", "supervisor"),
    passwordEnv: "E2E_SUPERVISOR_PASSWORD",
    isAdmin: false,
    canReview: true,
    expectedModules: [
      "daily_reports",
      "incident_reports",
      "ice_operations",
      "ice_depth",
    ],
    expectedLandingPath: "/dashboard",
  },
  icetech: {
    role: "icetech",
    email: emailFor("icetech", "icetech"),
    passwordEnv: "E2E_ICETECH_PASSWORD",
    isAdmin: false,
    canReview: false,
    expectedModules: [
      "ice_operations",
      "ice_depth",
      "refrigeration",
      "air_quality",
    ],
    expectedLandingPath: "/dashboard",
  },
  frontdesk: {
    role: "frontdesk",
    email: emailFor("frontdesk", "frontdesk"),
    passwordEnv: "E2E_FRONTDESK_PASSWORD",
    isAdmin: false,
    canReview: false,
    expectedModules: ["daily_reports", "incident_reports", "accident_reports"],
    expectedLandingPath: "/dashboard",
  },
  concessions: {
    role: "concessions",
    email: emailFor("concessions", "concessions"),
    passwordEnv: "E2E_CONCESSIONS_PASSWORD",
    isAdmin: false,
    canReview: false,
    expectedModules: ["daily_reports"],
    expectedLandingPath: "/dashboard",
  },
  janitorial: {
    role: "janitorial",
    email: emailFor("janitorial", "janitorial"),
    passwordEnv: "E2E_JANITORIAL_PASSWORD",
    isAdmin: false,
    canReview: false,
    expectedModules: ["daily_reports"],
    expectedLandingPath: "/dashboard",
  },
}

export const ALL_ROLES = Object.keys(USERS) as RoleKey[]
export const STAFF_ROLES = ALL_ROLES.filter((r) => !USERS[r].isAdmin)
export const ADMIN_ROLES = ALL_ROLES.filter((r) => USERS[r].isAdmin)

export function passwordFor(role: RoleKey): string | undefined {
  return process.env[USERS[role].passwordEnv]
}

/** A user whose password env var is set (so the test can actually run). */
export function hasCredentials(role: RoleKey): boolean {
  const pw = passwordFor(role)
  return typeof pw === "string" && pw.length > 0
}

// ── Inactive account (for the "inactive users cannot log in" check) ──────────
export const INACTIVE_USER = {
  email: process.env.E2E_INACTIVE_EMAIL ?? `inactive-test@${DEFAULT_DOMAIN}`,
  passwordEnv: "E2E_INACTIVE_PASSWORD",
}

// ── Second facility, for multi-tenant isolation (section 9) ──────────────────
// A user that belongs to Facility B. Section 9 confirms a Facility A user
// cannot read Facility B data. Provide a known Facility-B report id/URL via
// E2E_FACILITY_B_REPORT_PATH to exercise direct-URL access.
export const FACILITY_B_USER = {
  email: process.env.E2E_FACILITY_B_EMAIL ?? `facilityb-test@${DEFAULT_DOMAIN}`,
  passwordEnv: "E2E_FACILITY_B_PASSWORD",
}

export function facilityBHasCredentials(): boolean {
  const pw = process.env[FACILITY_B_USER.passwordEnv]
  return typeof pw === "string" && pw.length > 0
}
