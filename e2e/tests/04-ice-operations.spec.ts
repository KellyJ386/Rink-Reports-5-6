import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

const ICE_USER: RoleKey = "icetech"

/** Open a shadcn <Select> by visible label text and choose its first option. */
async function pickFirst(
  page: import("@playwright/test").Page,
  triggerText: RegExp,
): Promise<boolean> {
  const trigger = page
    .getByRole("combobox")
    .filter({ hasText: triggerText })
    .first()
  const fallback = page.locator('[placeholder]').first()
  const target = (await trigger.isVisible().catch(() => false))
    ? trigger
    : fallback
  if (!(await target.isVisible().catch(() => false))) return false
  await target.click()
  const opt = page.getByRole("option").first()
  if (!(await opt.isVisible().catch(() => false))) return false
  await opt.click()
  return true
}

test.describe("4. Ice Operations", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(ICE_USER), `No credentials for ${ICE_USER}`)
    await login(page, ICE_USER)
  })

  test("Ice Make form submits correctly", async ({ page }) => {
    await page.goto("/reports/ice-operations/ice_make")
    test.skip(
      await page.getByText(/access denied|not found/i).first().isVisible().catch(() => false),
      "ice_make route not available for this user",
    )

    const rink = await pickFirst(page, /select rink/i)
    const machine = await pickFirst(page, /select machine/i)
    test.skip(!rink || !machine, "TODO(seed): no rink/machine configured")

    // Optional numeric fields can be left blank.
    await page.locator("#water_used_gal").fill("250").catch(() => {})
    await page.getByRole("button", { name: /submit resurface/i }).click()

    await expect(page).toHaveURL(/\/done/)
    await expect(page.getByRole("heading", { name: /submitted/i })).toBeVisible()
  })

  test("Circle Check: failed items require notes (and pass/fail toggles work)", async ({
    page,
  }) => {
    await page.goto("/reports/ice-operations/circle_check")
    const machine = await pickFirst(page, /select machine/i)
    test.skip(!machine, "TODO(seed): no machine/checklist template configured")

    // Mark the first checklist item as Fail.
    const failButton = page.getByRole("button", { name: /^fail$/i }).first()
    test.skip(
      !(await failButton.isVisible().catch(() => false)),
      "TODO(seed): no circle-check items rendered",
    )
    await failButton.click()

    // With a failed item and no note, submitting must be blocked: either the
    // submit button is disabled or the required-note error is shown.
    const submit = page.getByRole("button", { name: /submit circle check/i })
    const noteField = page
      .getByPlaceholder(/describe the issue/i)
      .first()
    await expect(noteField).toBeVisible()

    if (await submit.isEnabled()) {
      await submit.click()
      await expect(
        page.getByText(/add a note for each failed item/i),
      ).toBeVisible()
      await expect(page).not.toHaveURL(/\/done/)
    } else {
      await expect(submit).toBeDisabled()
    }

    // Adding the note unblocks submission.
    await noteField.fill("Blade nick found; flagged for replacement.")
    await expect(submit).toBeEnabled()
  })

  test("Circle Check with a failed item surfaces the failure on the done page (Communications alert)", async ({
    page,
  }) => {
    await page.goto("/reports/ice-operations/circle_check")
    const machine = await pickFirst(page, /select machine/i)
    test.skip(!machine, "TODO(seed): no machine/checklist template configured")

    const failButton = page.getByRole("button", { name: /^fail$/i }).first()
    test.skip(
      !(await failButton.isVisible().catch(() => false)),
      "TODO(seed): no circle-check items rendered",
    )
    await failButton.click()
    await page
      .getByPlaceholder(/describe the issue/i)
      .first()
      .fill("Hydraulic leak — manager notified.")

    await page.getByRole("button", { name: /submit circle check/i }).click()
    await expect(page).toHaveURL(/\/done/)

    // The done page badges the failure count; the failed item is what triggers
    // the Communications alert to managers.
    await expect(page.getByText(/failed item/i)).toBeVisible()
    // TODO(seed): to verify the alert was actually dispatched, assert it
    // appears in Admin → Communications for a manager session (requires the
    // failed-item → routing rule to be configured in staging).
  })

  test("End-of-day PDF can be generated", async ({ page }) => {
    // The ice-operations summary / end-of-day PDF is reachable from the admin
    // ice-operations area. Assert the export/PDF affordance exists and triggers
    // a download.
    await page.goto("/reports/ice-operations")
    const pdfTrigger = page.getByRole("button", { name: /pdf|export|end of day/i }).first()
    const pdfLink = page.getByRole("link", { name: /pdf|export|end of day/i }).first()
    const trigger = (await pdfTrigger.isVisible().catch(() => false))
      ? pdfTrigger
      : pdfLink
    test.skip(
      !(await trigger.isVisible().catch(() => false)),
      "TODO(seed): no end-of-day PDF affordance on the staff ice-operations page (may be admin-only)",
    )
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }).catch(() => null),
      trigger.click(),
    ])
    expect(download, "Expected a PDF download to start").not.toBeNull()
  })
})
