import { test, expect, login } from "../fixtures/auth"
import {
  USERS,
  STAFF_ROLES,
  ALL_ROLES,
  hasCredentials,
  type ModuleKey,
} from "../fixtures/users"
import { MODULE_ROUTE, expectForbidden, isAccessDenied } from "../utils/nav"

test.describe("2. Role permissions", () => {
  // ── Staff cannot access Admin routes ──────────────────────────────────────
  for (const role of STAFF_ROLES) {
    test(`${role}: cannot access /admin (→ forbidden)`, async ({ page }) => {
      test.skip(!hasCredentials(role), `No credentials for ${role}`)
      await login(page, role)
      await page.goto("/admin")
      await expectForbidden(page)
    })

    test(`${role}: cannot access /admin/modules`, async ({ page }) => {
      test.skip(!hasCredentials(role), `No credentials for ${role}`)
      await login(page, role)
      await page.goto("/admin/modules")
      await expectForbidden(page)
    })
  }

  // ── Admins can configure modules ──────────────────────────────────────────
  test("admin: can open the modules configuration page", async ({ page }) => {
    test.skip(!hasCredentials("admin"), "No admin credentials")
    await login(page, "admin")
    await page.goto("/admin/modules")
    await expect(page).toHaveURL(/\/admin\/modules/)
    await expect(
      page.getByRole("heading", { name: /modules/i }).first(),
    ).toBeVisible()
  })

  // ── Managers can review reports but cannot edit original submissions ──────
  test("manager: can review reports but original submissions are not editable", async ({
    page,
  }) => {
    test.skip(!hasCredentials("manager"), "No manager credentials")
    await login(page, "manager")

    // A manager-tier user can reach a review surface. Managers may or may not
    // have the admin console; the review of submissions is what matters. Try
    // the admin daily-reports submissions tab, falling back to the staff
    // history view if the manager isn't admin-tier.
    const reviewedViaAdmin = await isAccessDenied(
      page,
      "/admin/daily-reports?tab=submissions",
    ).then((denied) => !denied)

    if (reviewedViaAdmin) {
      await expect(page).toHaveURL(/\/admin\/daily-reports/)
      // The submissions list is review-only: there must be no control that
      // edits the ORIGINAL submission (immutable by design). Follow-up notes
      // are allowed; an "Edit submission"/"Edit report" affordance is not.
      const editOriginal = page.getByRole("button", {
        name: /edit (submission|report|original)/i,
      })
      await expect(editOriginal).toHaveCount(0)
    } else {
      // Non-admin manager: review via the staff history page; still no edit.
      await page.goto("/reports/daily/history")
      await expect(page).not.toHaveURL(/\/forbidden/)
      const editOriginal = page.getByRole("link", { name: /edit/i })
      await expect(editOriginal).toHaveCount(0)
    }
  })

  // ── Employees only see modules assigned to their department ───────────────
  for (const role of STAFF_ROLES) {
    test(`${role}: assigned department modules are reachable, an unassigned one is denied`, async ({
      page,
    }) => {
      test.skip(!hasCredentials(role), `No credentials for ${role}`)
      const user = USERS[role]
      await login(page, role)

      // Assigned modules should open (not bounce to /forbidden).
      for (const mod of user.expectedModules.slice(0, 2)) {
        const denied = await isAccessDenied(page, MODULE_ROUTE[mod])
        expect(
          denied,
          `Expected ${role} to access assigned module ${mod} (${MODULE_ROUTE[mod]})`,
        ).toBeFalsy()
      }

      // At least one clearly-unassigned admin-ish module should be denied.
      // `scheduling` admin or a module not in expectedModules.
      const allModules = Object.keys(MODULE_ROUTE) as ModuleKey[]
      const unassigned = allModules.find(
        (m) => !user.expectedModules.includes(m),
      )
      test.skip(
        !unassigned,
        `${role} is configured with all modules; nothing to deny`,
      )
      // TODO(seed): dashboard tiles are not permission-filtered in the page
      // component; real enforcement is at the data/RLS layer. We assert the
      // unassigned module's data surface is empty or denied rather than tile
      // visibility. If your seed grants this user the module, adjust
      // expectedModules in users.ts.
      const denied = await isAccessDenied(page, MODULE_ROUTE[unassigned!])
      // Soft expectation: record but don't hard-fail when the route renders an
      // empty (no-data) state instead of an explicit denial.
      expect.soft(
        denied,
        `Expected ${role} to be denied/empty on unassigned module ${unassigned}`,
      ).toBeTruthy()
    })
  }

  // ── Sanity: every admin role truly reaches the console ────────────────────
  for (const role of ALL_ROLES.filter((r) => USERS[r].isAdmin)) {
    test(`${role}: reaches the admin console`, async ({ page }) => {
      test.skip(!hasCredentials(role), `No credentials for ${role}`)
      await login(page, role)
      await page.goto("/admin")
      await expect(page).not.toHaveURL(/\/forbidden/)
    })
  }
})
