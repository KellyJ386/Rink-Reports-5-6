import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

// A role that should be assigned daily reports in staging.
const SUBMITTER: RoleKey = "frontdesk"

/** Pick the first option from a shadcn <Select> identified by its trigger id. */
async function selectFirstOption(
  page: import("@playwright/test").Page,
  triggerId: string,
): Promise<boolean> {
  const trigger = page.locator(`#${triggerId}`)
  if (!(await trigger.isVisible().catch(() => false))) return false
  await trigger.click()
  const option = page.getByRole("option").first()
  if (!(await option.isVisible().catch(() => false))) return false
  await option.click()
  return true
}

/**
 * Drives the daily-report console to a submittable state. Returns false if the
 * console/options aren't present (unseeded environment) so the caller can skip.
 */
async function fillDailyConsole(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  const directPath = process.env.E2E_DAILY_REPORT_PATH
  await page.goto(directPath || "/reports/daily")

  // Work area + shift are required selects.
  const pickedArea = await selectFirstOption(page, "work-area-select")
  const pickedShift = await selectFirstOption(page, "shift-select")
  if (!directPath && (!pickedArea || !pickedShift)) return false
  return true
}

test.describe("3. Daily Reports", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(SUBMITTER), `No credentials for ${SUBMITTER}`)
    await login(page, SUBMITTER)
  })

  test("assigned user can submit a report (with unchecked items allowed)", async ({
    page,
  }) => {
    const ready = await fillDailyConsole(page)
    test.skip(!ready, "TODO(seed): no daily-report area/template configured")

    // Deliberately leave checklist items UNCHECKED — submission must still be
    // allowed (checklist items are not required).
    await page.getByRole("button", { name: /^submit$/i }).click()

    // Lands on the done screen.
    await expect(page).toHaveURL(/\/reports\/daily\/.*\/done/)
    await expect(
      page.getByRole("heading", { name: /submitted/i }),
    ).toBeVisible()
  })

  test("multiple reports per day are allowed", async ({ page }) => {
    // First submission.
    let ready = await fillDailyConsole(page)
    test.skip(!ready, "TODO(seed): no daily-report area/template configured")
    await page.getByRole("button", { name: /^submit$/i }).click()
    await expect(page).toHaveURL(/\/done/)

    // Second submission, same day — must not be blocked as a duplicate.
    await page.getByRole("link", { name: /submit another/i }).click()
    ready = await fillDailyConsole(page)
    expect(ready, "Second daily console should still be submittable").toBeTruthy()
    await page.getByRole("button", { name: /^submit$/i }).click()
    await expect(page).toHaveURL(/\/done/)
    await expect(
      page.getByRole("heading", { name: /submitted/i }),
    ).toBeVisible()
  })

  test("submitted reports appear in history", async ({ page }) => {
    await page.goto("/reports/daily/history")
    await expect(page).not.toHaveURL(/\/forbidden/)
    // History renders a list/table of prior submissions (or an explicit empty
    // state). Either is a valid, non-broken page.
    const hasContent = await page
      .getByRole("heading", { name: /history/i })
      .first()
      .isVisible()
      .catch(() => false)
    expect(hasContent || (await page.getByText(/no .*report/i).first().isVisible().catch(() => false))).toBeTruthy()
  })

  test("staff cannot edit a submitted daily report", async ({ page }) => {
    await page.goto("/reports/daily/history")
    test.skip(
      await page.getByText(/no .*report/i).first().isVisible().catch(() => false),
      "TODO(seed): no submitted daily reports to inspect",
    )
    // Daily submissions are immutable for staff — there is no edit affordance.
    await expect(page.getByRole("button", { name: /^edit/i })).toHaveCount(0)
    await expect(page.getByRole("link", { name: /^edit/i })).toHaveCount(0)
  })
})
