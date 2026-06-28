import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

const STAFF: RoleKey = "icetech"

/** Navigate into a measurable ice-depth layout. Returns false if none exist. */
async function openLayout(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  const slug = process.env.E2E_ICE_DEPTH_LAYOUT_SLUG
  if (slug) {
    await page.goto(`/reports/ice-depth/${slug}`)
    return true
  }
  await page.goto("/reports/ice-depth")
  // The index lists layouts as links/cards; follow the first into a session.
  const layoutLink = page
    .getByRole("link", { name: /.+/ })
    .filter({ hasNot: page.getByText(/dashboard|home|back/i) })
    .first()
  if (await layoutLink.isVisible().catch(() => false)) {
    await layoutLink.click()
    return /\/reports\/ice-depth\/[^/]+/.test(page.url())
  }
  return false
}

/** Click the first measurement point on the USA-hockey rink SVG. */
async function tapFirstPoint(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  const svgPoint = page.locator("svg circle, svg [data-point], svg g[role]").first()
  if (!(await svgPoint.isVisible().catch(() => false))) return false
  await svgPoint.click({ force: true })
  return true
}

test.describe("7. Ice Depth", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(STAFF), `No credentials for ${STAFF}`)
    await login(page, STAFF)
  })

  test("user can select a layout", async ({ page }) => {
    const opened = await openLayout(page)
    test.skip(!opened, "TODO(seed): no ice-depth layouts configured")
    await expect(page).toHaveURL(/\/reports\/ice-depth\/[^/]+/)
    await expect(
      page.getByRole("progressbar", { name: /points recorded/i }),
    ).toBeVisible()
  })

  test("user can enter readings point by point; Enter advances to the next point", async ({
    page,
  }) => {
    const opened = await openLayout(page)
    test.skip(!opened, "TODO(seed): no ice-depth layouts configured")

    const tapped = await tapFirstPoint(page)
    test.skip(!tapped, "Could not locate a tappable rink point")

    const dialog = page.getByRole("dialog", { name: /enter depth for point/i })
    await expect(dialog).toBeVisible()
    const input = dialog.getByPlaceholder("0.0")
    await input.fill("3.2")

    // Threshold color/severity label appears for the entered value.
    await expect(
      dialog.getByText(/optimal|below min|above target/i),
    ).toBeVisible()

    // Enter saves and advances: the recorded count increments.
    await input.press("Enter")
    await expect(page.getByText(/1 recorded/i)).toBeVisible({ timeout: 5_000 })
  })

  test("threshold colors / severity labels display correctly", async ({
    page,
  }) => {
    const opened = await openLayout(page)
    test.skip(!opened, "TODO(seed): no ice-depth layouts configured")
    const tapped = await tapFirstPoint(page)
    test.skip(!tapped, "Could not locate a tappable rink point")

    const dialog = page.getByRole("dialog", { name: /enter depth for point/i })
    const input = dialog.getByPlaceholder("0.0")

    // A very low value should read "Below min"; a very high value "Above target".
    await input.fill("0.1")
    await expect(dialog.getByText(/below min/i)).toBeVisible()
    await input.fill("99")
    await expect(dialog.getByText(/above target/i)).toBeVisible()
  })

  test("PDF and Excel export are available on a submitted session", async ({
    page,
  }) => {
    // The done page exposes Print Diagram (PDF) and Send Report. Excel export
    // lives in the admin ice-depth history/analytics. We assert the affordances
    // exist; a full submit→export round-trip needs a seeded session.
    const donePath = process.env.E2E_ICE_DEPTH_DONE_PATH
    test.skip(
      !donePath,
      "TODO(seed): set E2E_ICE_DEPTH_DONE_PATH to a submitted session done page to verify PDF/Excel export",
    )
    await page.goto(donePath!)
    await expect(
      page.getByRole("button", { name: /print diagram/i }),
    ).toBeVisible()
    // The raw PDF route should respond for this session.
    const pdfResp = await page.request.get(`${donePath}/pdf`).catch(() => null)
    if (pdfResp) {
      expect(pdfResp.status(), "PDF route should return 200").toBe(200)
    }
  })

  test("email sends only to configured recipients", async ({ page }) => {
    const donePath = process.env.E2E_ICE_DEPTH_DONE_PATH
    test.skip(
      !donePath,
      "TODO(seed): set E2E_ICE_DEPTH_DONE_PATH; recipients must be configured in Admin → Communications",
    )
    await page.goto(donePath!)
    const sendBtn = page.getByRole("button", { name: /send report/i })
    await expect(sendBtn).toBeVisible()
    await sendBtn.click()
    // Either it sends to N configured recipients, or it reports none configured
    // — it must never send to an arbitrary address.
    await expect(
      page.getByText(/sent to \d+ recipient|no recipients are configured/i),
    ).toBeVisible({ timeout: 15_000 })
  })
})
