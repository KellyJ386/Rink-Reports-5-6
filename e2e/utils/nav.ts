import { expect, type Page } from "@playwright/test"

import type { ModuleKey } from "../fixtures/users"

/** Staff report route for each module tile (mirrors dashboard KNOWN_MODULES). */
export const MODULE_ROUTE: Record<ModuleKey, string> = {
  daily_reports: "/reports/daily",
  incident_reports: "/reports/incidents",
  accident_reports: "/reports/accidents",
  refrigeration: "/reports/refrigeration",
  air_quality: "/reports/air-quality",
  ice_operations: "/reports/ice-operations",
  ice_depth: "/reports/ice-depth",
  communications: "/reports/communications",
  scheduling: "/reports/scheduling",
  facility_paperwork: "/reports/facility-paperwork",
}

/**
 * Asserts the current page is the access-denied state. Non-admins hitting an
 * /admin route land on /forbidden ("Access denied"); unauthenticated users
 * land on /login.
 */
export async function expectForbidden(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/forbidden/)
  await expect(
    page.getByRole("heading", { name: /access denied/i }),
  ).toBeVisible()
}

export async function expectLoginRedirect(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/login/)
}

/**
 * Returns true if navigating to `route` was effectively denied — either a
 * /forbidden bounce, a /login bounce, or a visibly empty/"no access" page.
 * Used by the department-scope and isolation checks where the exact denial
 * surface varies by route.
 */
export async function isAccessDenied(
  page: Page,
  route: string,
): Promise<boolean> {
  const resp = await page.goto(route, { waitUntil: "domcontentloaded" })
  const url = page.url()
  if (/\/forbidden|\/login/.test(url)) return true
  if (resp && (resp.status() === 403 || resp.status() === 404)) return true
  // Heuristic: an explicit access-denied / not-found message on the page body.
  const deniedText = page.getByText(
    /access denied|not authorized|no access|don't have permission|forbidden|not found/i,
  )
  return await deniedText
    .first()
    .isVisible()
    .catch(() => false)
}
