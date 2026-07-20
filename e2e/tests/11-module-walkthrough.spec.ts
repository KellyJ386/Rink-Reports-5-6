import path from "node:path"

import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"
import { watchConsole } from "../utils/console-guard"

/**
 * 11. Module walkthrough.
 *
 * A visual crawl of every module in the app. For each page it logs in, visits
 * the route, asserts the page rendered a real screen (no /login or /forbidden
 * bounce, no crash / access-denied UI, a visible heading or main landmark),
 * checks for page-level exceptions, and captures a full-page screenshot to
 * `e2e/report/walkthrough/`.
 *
 * Runs on the desktop project only, and skips gracefully when the admin
 * account has no seeded credentials.
 */

// ── Desktop-only: this is a visual walkthrough; one project is enough. ───────
test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "chromium-desktop",
    "desktop only",
  )
})

const SHOTS_DIR = path.resolve(__dirname, "..", "report", "walkthrough")

/** Turn a route into a safe screenshot filename, e.g. /reports/daily → reports-daily.png */
function shotName(route: string, prefix = ""): string {
  const slug = route.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-") || "root"
  return `${prefix}${slug}.png`
}

/**
 * Visit `route`, wait for it to settle, run the render assertions, capture a
 * console-error collector, and screenshot it. Returns nothing — assertions
 * throw on failure so each generated test fails independently.
 */
async function walkPage(
  page: import("@playwright/test").Page,
  route: string,
  prefix = "",
): Promise<void> {
  const consoleGuard = watchConsole(page)

  await page.goto(route, { waitUntil: "domcontentloaded" })
  // Let client hydration + data fetches settle; cold serverless starts can be
  // slow, so this is generous and never hard-fails on a lingering socket.
  await page.waitForLoadState("networkidle").catch(() => {})
  await page
    .locator("main, h1, h2, [role='main']")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {})

  // 1) Not bounced to an auth / denial route.
  await expect(page, `${route} should not redirect to /login`).not.toHaveURL(
    /\/login/,
  )
  await expect(
    page,
    `${route} should not redirect to /forbidden`,
  ).not.toHaveURL(/\/forbidden/)

  // 2) No crash / error-boundary / access-denied UI on the page body.
  const crashUI = await page
    .getByText(
      /application error|something went wrong|access denied|unhandled|internal server error/i,
    )
    .first()
    .isVisible()
    .catch(() => false)
  expect(crashUI, `${route} rendered an error/denied screen`).toBeFalsy()

  // 3) Real content present: a visible heading or a main landmark.
  const hasContent = await page
    .locator("h1, h2, main, [role='main']")
    .first()
    .isVisible()
    .catch(() => false)
  expect(hasContent, `${route} rendered no visible heading/main content`).toBeTruthy()

  // 4) Screenshot for the visual record.
  await page.screenshot({
    path: path.join(SHOTS_DIR, shotName(route, prefix)),
    fullPage: true,
  })

  // 5) No page-level exceptions while rendering this page.
  await consoleGuard.assertClean(test.info())
}

// ── Route inventory (verified against src/app/reports/* and src/app/admin/*) ──
const STAFF_ROUTES: string[] = [
  "/dashboard",
  "/reports/daily",
  "/reports/daily/history",
  "/reports/incidents",
  "/reports/accidents",
  "/reports/refrigeration",
  "/reports/air-quality",
  "/reports/ice-operations",
  "/reports/ice-depth",
  "/reports/communications",
  "/reports/scheduling",
  "/reports/scheduling/my-schedule",
  "/reports/scheduling/time-off",
  "/reports/facility-paperwork",
  "/reports/offline-queue",
]

const ADMIN_ROUTES: string[] = [
  "/admin",
  "/admin/daily-reports",
  // The admin consoles for incidents/accidents live under the *-reports slugs.
  "/admin/incident-reports",
  "/admin/accident-reports",
  "/admin/refrigeration",
  "/admin/air-quality",
  "/admin/ice-operations",
  "/admin/ice-depth",
  "/admin/communications",
  "/admin/scheduling",
  "/admin/employees",
  "/admin/permissions",
  "/admin/exports",
  "/admin/retention",
  // `/admin/settings` does not exist; the real top-level consoles are:
  "/admin/modules",
  "/admin/facility",
]

// A short list of ice-tech-facing modules for the second-role walkthrough.
const ICETECH_ROUTES: string[] = [
  "/dashboard",
  "/reports/ice-operations",
  "/reports/ice-depth",
  "/reports/refrigeration",
  "/reports/air-quality",
]

const ADMIN: RoleKey = "admin"
const ICETECH: RoleKey = "icetech"

test.describe("11. Module walkthrough (admin)", () => {
  test.skip(
    !hasCredentials(ADMIN),
    `No credentials for "${ADMIN}" — set E2E_ADMIN_PASSWORD in e2e/.env.e2e.local`,
  )

  test.describe("staff-facing modules", () => {
    for (const route of STAFF_ROUTES) {
      test(`admin walks ${route}`, async ({ page }) => {
        await login(page, ADMIN)
        await walkPage(page, route)
      })
    }
  })

  test.describe("admin console modules", () => {
    for (const route of ADMIN_ROUTES) {
      test(`admin walks ${route}`, async ({ page }) => {
        await login(page, ADMIN)
        await walkPage(page, route)
      })
    }
  })
})

test.describe("11. Module walkthrough (icetech)", () => {
  test.skip(
    !hasCredentials(ICETECH),
    `No credentials for "${ICETECH}" — set E2E_ICETECH_PASSWORD in e2e/.env.e2e.local`,
  )

  for (const route of ICETECH_ROUTES) {
    test(`icetech walks ${route}`, async ({ page }) => {
      await login(page, ICETECH)
      await walkPage(page, route, "icetech-")
    })
  }

  test("icetech is denied the admin console (→ forbidden)", async ({ page }) => {
    await login(page, ICETECH)
    await page.goto("/admin", { waitUntil: "domcontentloaded" })
    await expect(page).toHaveURL(/\/forbidden/)
    await expect(
      page.getByRole("heading", { name: /access denied/i }),
    ).toBeVisible()
  })
})
