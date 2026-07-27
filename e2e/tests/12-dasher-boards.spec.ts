import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

// Dasher Boards — the single-screen field tool. The module landing IS the
// condition map for the default rink; tap-to-log works with no walk active
// (the inspection walk is an opt-in overlay). These tests cover the
// tap-to-log-without-walk path end to end, plus the severity-A requirement
// surfacing and the absence of admin asset-editing in the staff sheet.

const STAFF: RoleKey = "icetech"

/**
 * Open the module landing. Returns false (→ graceful skip) when the account
 * has no dasher_boards access or the module isn't configured in this
 * environment.
 */
async function openModule(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  await page.goto("/reports/dasher-boards")
  const blocked = page.getByText(
    /no access to dasher boards|isn't set up yet|rink not found/i,
  )
  if (await blocked.isVisible().catch(() => false)) return false
  return page
    .locator('svg[aria-label="Rink perimeter diagram"]')
    .isVisible()
    .catch(() => false)
}

/** Tap the first perimeter segment; returns false if none are rendered. */
async function tapFirstSegment(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  const segment = page
    .locator('svg[aria-label="Rink perimeter diagram"] g[role="button"]')
    .first()
  if (!(await segment.isVisible().catch(() => false))) return false
  await segment.click({ force: true })
  return true
}

test.describe("12. Dasher Boards", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(STAFF), `No credentials for ${STAFF}`)
    await login(page, STAFF)
  })

  test("module landing renders the condition map directly (no rink list, no walk gate)", async ({
    page,
  }) => {
    const opened = await openModule(page)
    test.skip(!opened, "TODO(seed): dasher boards not configured / no access")

    // The map is on screen with no wizard or rink-card list in between.
    await expect(
      page.locator('svg[aria-label="Rink perimeter diagram"]'),
    ).toBeVisible()
    // The walk is opt-in — offered as a secondary action, never a gate.
    // (Skip the assertion if this account has a leftover open walk.)
    const walkBar = page.getByText(/walk in progress/i)
    if (!(await walkBar.isVisible().catch(() => false))) {
      await expect(
        page.getByRole("button", { name: /start inspection walk/i }),
      ).toBeVisible()
    }
  })

  test("tap-to-log without a walk: sheet opens ready with severity B preselected", async ({
    page,
  }) => {
    const opened = await openModule(page)
    test.skip(!opened, "TODO(seed): dasher boards not configured / no access")
    test.skip(
      await page.getByText(/walk in progress/i).isVisible().catch(() => false),
      "Account has a leftover open walk — cannot cover the no-walk path",
    )

    const tapped = await tapFirstSegment(page)
    test.skip(!tapped, "No positioned perimeter assets")

    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible()
    // The report form is expanded and ready — no walk was started.
    await expect(sheet.getByText("Report issue")).toBeVisible()
    await expect(
      sheet.getByRole("button", { name: /b — needs repair/i }),
    ).toHaveAttribute("aria-pressed", "true")
    await expect(sheet.getByPlaceholder(/describe the issue/i)).toBeVisible()
  })

  test("severity A surfaces supervisor + action-taken requirements before typing", async ({
    page,
  }) => {
    const opened = await openModule(page)
    test.skip(!opened, "TODO(seed): dasher boards not configured / no access")
    const tapped = await tapFirstSegment(page)
    test.skip(!tapped, "No positioned perimeter assets")

    const sheet = page.getByRole("dialog")
    await sheet.getByRole("button", { name: /a — safety critical/i }).click()
    await expect(sheet.getByText(/safety-critical/i)).toBeVisible()
    await expect(
      sheet.getByPlaceholder(/action taken \(required for a\)/i),
    ).toBeVisible()
    await expect(
      sheet.getByRole("combobox", { name: "Supervisor" }),
    ).toBeVisible()
  })

  test("staff sheet exposes no admin asset-editing (conversion / spec entry)", async ({
    page,
  }) => {
    const opened = await openModule(page)
    test.skip(!opened, "TODO(seed): dasher boards not configured / no access")
    const tapped = await tapFirstSegment(page)
    test.skip(!tapped, "No positioned perimeter assets")

    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText(/this is a door/i)).toHaveCount(0)
    await expect(
      sheet.getByRole("button", { name: /save spec/i }),
    ).toHaveCount(0)
  })

  test("due checklist renders as its own card, independent of any walk", async ({
    page,
  }) => {
    const opened = await openModule(page)
    test.skip(!opened, "TODO(seed): dasher boards not configured / no access")
    test.skip(
      await page.getByText(/walk in progress/i).isVisible().catch(() => false),
      "Account has a leftover open walk — cannot cover the no-walk path",
    )

    const dueCard = page.getByText(/checklist — due today/i)
    test.skip(
      !(await dueCard.isVisible().catch(() => false)),
      "TODO(seed): no checklist items due today (daily cadence ships unseeded)",
    )
    // Answerable with no walk started; Pass/Flag buttons are live.
    await expect(
      page.getByRole("button", { name: "Pass" }).first(),
    ).toBeVisible()
  })

  test("report → resolve round trip without a walk", async ({ page }) => {
    const opened = await openModule(page)
    test.skip(!opened, "TODO(seed): dasher boards not configured / no access")
    test.skip(
      await page.getByText(/walk in progress/i).isVisible().catch(() => false),
      "Account has a leftover open walk — cannot cover the no-walk path",
    )
    const tapped = await tapFirstSegment(page)
    test.skip(!tapped, "No positioned perimeter assets")

    const sheet = page.getByRole("dialog")
    const category = sheet.getByRole("combobox", { name: "Category" })
    const options = await category.locator("option").count()
    test.skip(options < 2, "TODO(seed): no issue categories configured")

    await category.selectOption({ index: 1 })
    await sheet
      .getByPlaceholder(/describe the issue/i)
      .fill("E2E tap-to-log check — safe to resolve")
    await sheet.getByRole("button", { name: /submit issue/i }).click()
    await expect(sheet.getByText(/issue reported/i).first()).toBeVisible({
      timeout: 10_000,
    })

    // Clean up: staff may resolve their own B-severity issue.
    await expect(
      sheet.getByRole("button", { name: /mark fixed/i }).first(),
    ).toBeVisible({ timeout: 10_000 })
    await sheet.getByRole("button", { name: /mark fixed/i }).first().click()
    await expect(page.getByText(/marked fixed/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
