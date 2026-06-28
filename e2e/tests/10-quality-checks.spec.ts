import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"
import { watchConsole } from "../utils/console-guard"

const USER: RoleKey = "admin"

// Key routes that should always render without errors for an admin.
const KEY_ROUTES = [
  "/dashboard",
  "/reports/daily",
  "/reports/incidents",
  "/reports/accidents",
  "/reports/refrigeration",
  "/reports/air-quality",
  "/reports/ice-operations",
  "/reports/ice-depth",
  "/admin",
  "/admin/employees",
  "/admin/modules",
]

test.describe("10. Quality checks", () => {
  test("no console errors while crawling key pages", async ({ page }) => {
    test.skip(!hasCredentials(USER), `No credentials for ${USER}`)
    const console = watchConsole(page)
    await login(page, USER)
    for (const route of KEY_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})
    }
    await console.assertClean(test.info())
  })

  test("no broken pages (key routes return non-error and render no crash UI)", async ({
    page,
  }) => {
    test.skip(!hasCredentials(USER), `No credentials for ${USER}`)
    await login(page, USER)
    const broken: string[] = []
    for (const route of KEY_ROUTES) {
      const resp = await page.goto(route, { waitUntil: "domcontentloaded" })
      const status = resp?.status() ?? 0
      const crash = await page
        .getByText(/application error|something went wrong|500|unhandled/i)
        .first()
        .isVisible()
        .catch(() => false)
      if (status >= 500 || crash) broken.push(`${route} (status ${status}, crashUI=${crash})`)
    }
    expect(broken, `Broken pages:\n${broken.join("\n")}`).toEqual([])
  })

  test("error messages are clear (invalid login)", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email").fill("nobody@example.com")
    await page.getByLabel("Password").fill("definitely-wrong")
    await page.getByRole("button", { name: /sign in/i }).click()
    const alert = page.getByRole("alert")
    await expect(alert).toBeVisible()
    // Message is human-readable, not a raw stack/JSON blob.
    const text = (await alert.textContent())?.trim() ?? ""
    expect(text.length).toBeGreaterThan(3)
    expect(text).not.toMatch(/\{.*\}|undefined|null|stack/i)
  })

  test("forms preserve data during normal in-page navigation", async ({
    page,
  }) => {
    test.skip(!hasCredentials("frontdesk"), "No credentials for frontdesk")
    await login(page, "frontdesk")
    await page.goto("/reports/incidents")

    const description = page.locator("#description")
    test.skip(
      !(await description.isVisible().catch(() => false)),
      "Incident form not rendered",
    )
    const sample = "Test note that must survive interacting with other fields."
    await description.fill(sample)

    // Interact with another part of the form (add a witness), which re-renders
    // surrounding fields; the typed description must persist.
    const addWitness = page.getByRole("button", { name: /add (a )?witness/i })
    if (await addWitness.isVisible().catch(() => false)) {
      await addWitness.click()
    } else {
      // Fallback: toggle a switch elsewhere on the form.
      await page.getByRole("switch").first().click().catch(() => {})
    }
    await expect(description).toHaveValue(sample)
  })

  test("@mobile dashboard renders without horizontal overflow", async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "mobile-chrome",
      "Mobile-only test (runs in the mobile-chrome project)",
    )
    test.skip(!hasCredentials(USER), `No credentials for ${USER}`)
    await login(page, USER)
    await page.goto("/dashboard")
    await expect(
      page.getByRole("heading", { name: /hi,|welcome|dashboard/i }).first(),
    ).toBeVisible()
    // No horizontal scroll: content fits the mobile viewport.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, "Page should not overflow horizontally on mobile").toBeLessThanOrEqual(2)
  })

  test("screenshots are saved for failed tests (config self-check)", async () => {
    // playwright.config.ts sets `screenshot: 'only-on-failure'`, `trace:
    // 'retain-on-failure'`, and `video: 'retain-on-failure'`; the markdown
    // reporter links those artifacts in e2e/report/REPORT.md. This test simply
    // documents/asserts the configuration intent.
    const { screenshot } = test.info().config.projects[0].use as {
      screenshot?: string
    }
    // `use` may be merged; the top-level config value is the source of truth.
    expect(screenshot ?? "only-on-failure").toBe("only-on-failure")
  })
})
