import { test, expect, login } from "../fixtures/auth"
import { STAFF_ROLES, hasCredentials } from "../fixtures/users"
import { expectForbidden } from "../utils/nav"

test.describe("8. Admin Control Center", () => {
  test.describe("admin can configure", () => {
    test.beforeEach(async ({ page }) => {
      test.skip(!hasCredentials("admin"), "No admin credentials")
      await login(page, "admin")
    })

    test("create/edit templates (daily reports → Templates tab)", async ({
      page,
    }) => {
      await page.goto("/admin/daily-reports?tab=templates")
      await expect(page).not.toHaveURL(/\/forbidden/)
      await expect(
        page.getByRole("heading", { name: /daily reports/i }).first(),
      ).toBeVisible()
      // The Templates tab + a create affordance are present.
      await expect(
        page.getByRole("tab", { name: /templates/i }),
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: /add|new|create/i }).first(),
      ).toBeVisible()
    })

    test("assign module access (permissions matrix)", async ({ page }) => {
      await page.goto("/admin/permissions")
      await expect(page).not.toHaveURL(/\/forbidden/)
      await expect(
        page.getByRole("heading", { name: /module access control/i }),
      ).toBeVisible()
      // Drilling into a user opens their (module × action) toggle matrix.
      const userLink = page.getByRole("link").filter({ hasNotText: /^$/ }).first()
      test.skip(
        !(await userLink.isVisible().catch(() => false)),
        "TODO(seed): no users listed in permissions",
      )
      await userLink.click()
      await expect(page).toHaveURL(/\/admin\/permissions\/[^/]+/)
    })

    test("activate/deactivate employees (controls present, non-destructive)", async ({
      page,
    }) => {
      await page.goto("/admin/employees")
      await expect(page).not.toHaveURL(/\/forbidden/)
      // Status filter + a per-row Deactivate/Reactivate control.
      const toggle = page
        .getByRole("button", { name: /deactivate|reactivate/i })
        .first()
      test.skip(
        !(await toggle.isVisible().catch(() => false)),
        "TODO(seed): no employees listed",
      )
      const label = (await toggle.textContent())?.trim() ?? ""
      await toggle.click()
      if (/deactivate/i.test(label)) {
        // Deactivation opens a confirm dialog — assert then CANCEL (no mutation).
        await expect(
          page.getByText(/deactivate this employee\?/i),
        ).toBeVisible()
        await page.getByRole("button", { name: /cancel/i }).click()
      }
    })

    test("configure thresholds (refrigeration & ice depth settings)", async ({
      page,
    }) => {
      await page.goto("/admin/refrigeration")
      await expect(page).not.toHaveURL(/\/forbidden/)
      await expect(
        page.getByRole("tab", { name: /setup|settings/i }).first(),
      ).toBeVisible()

      await page.goto("/admin/ice-depth")
      await expect(page).not.toHaveURL(/\/forbidden/)
      await expect(
        page.getByRole("tab", { name: /settings/i }).first(),
      ).toBeVisible()
    })

    test("configure PDF / export settings", async ({ page }) => {
      await page.goto("/admin/exports")
      await expect(page).not.toHaveURL(/\/forbidden/)
      await expect(
        page.getByRole("heading", { name: /export/i }).first(),
      ).toBeVisible()
    })
  })

  // ── Non-admin users cannot access these pages ──────────────────────────────
  const ADMIN_PAGES = [
    "/admin/daily-reports",
    "/admin/permissions",
    "/admin/employees",
    "/admin/refrigeration",
    "/admin/exports",
    "/admin/modules",
  ]
  for (const role of STAFF_ROLES) {
    test(`${role}: cannot access admin control-center pages`, async ({
      page,
    }) => {
      test.skip(!hasCredentials(role), `No credentials for ${role}`)
      await login(page, role)
      for (const url of ADMIN_PAGES) {
        await page.goto(url)
        await expectForbidden(page)
      }
    })
  }
})
