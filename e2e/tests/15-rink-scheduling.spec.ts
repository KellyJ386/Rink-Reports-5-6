import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

/**
 * Rink Scheduling & Billing (Module 12) — the most money-critical module in
 * the app and, until this spec, the only major one with no browser coverage.
 *
 * Posture matches 13-scheduling: this suite runs against a SHARED deployed
 * environment, so nothing here creates, moves, or cancels a booking, and
 * nothing touches an invoice or payment — the exclusion constraint means a
 * test booking would collide with (or block) real slots, and billing rows
 * are append-only by design. What IS driven:
 *
 *   - every staff surface renders per role, without a crash;
 *   - the edit-tier gates hold together as a set (an account that can't see
 *     "New series" must also be denied the money pages — asserted as an
 *     INVARIANT between affordances, so the spec is seed-independent);
 *   - the booking sheet opens from a click-to-create slot and closes clean —
 *     opening the sheet writes nothing;
 *   - the admin console tabs all render for an admin.
 */

const STAFF: RoleKey = "icetech"

const CALENDAR = "/reports/rink-scheduling"

/** Opens a rink-scheduling page; false when the module is gated off for the
 *  account (the NotAvailable card) or the account lacks a facility. */
async function openRinkScheduling(
  page: import("@playwright/test").Page,
  path = "",
): Promise<boolean> {
  await page.goto(`${CALENDAR}${path}`)
  const denied = page.getByText(/rink schedule not available/i)
  if (await denied.isVisible().catch(() => false)) return false
  return page
    .getByRole("heading", { level: 1 })
    .first()
    .isVisible()
    .catch(() => false)
}

test.describe("15. Rink Scheduling (staff)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(STAFF), `No credentials for ${STAFF}`)
    await login(page, STAFF)
  })

  test("calendar renders with all four views reachable", async ({ page }) => {
    const opened = await openRinkScheduling(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for this account")

    await expect(page.getByRole("heading", { name: /rink schedule/i })).toBeVisible()

    for (const view of ["day", "week", "month", "list"]) {
      await page.goto(`${CALENDAR}?view=${view}`)
      await expect(page).not.toHaveURL(/\/forbidden|\/login/)
      await expect(page.locator("body")).not.toContainText(
        /application error|something went wrong/i,
      )
    }
  })

  test("edit-tier affordances gate together, not piecemeal", async ({ page }) => {
    const opened = await openRinkScheduling(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for this account")

    // "New series" (edit), the Invoices link (edit) and the click-to-create
    // slot overlay (submit-or-edit) are gated by the same permission model.
    // Whatever this account is seeded as, they must AGREE: an account shown
    // "New series" must be shown Invoices, and an account shown neither must
    // also be refused the invoices page outright when it navigates directly —
    // route placement is UX, never the authorization boundary.
    const canEdit = await page
      .getByRole("button", { name: /new series/i })
      .isVisible()
      .catch(() => false)
    const seesInvoicesLink = await page
      .getByRole("link", { name: /invoices/i })
      .first()
      .isVisible()
      .catch(() => false)
    expect(seesInvoicesLink).toBe(canEdit)

    await page.goto(`${CALENDAR}/invoices`)
    const deniedInvoices = await page
      .getByText(/rink schedule not available/i)
      .isVisible()
      .catch(() => false)
    // Edit-tier reaches the page; anyone else gets the NotAvailable card.
    expect(deniedInvoices).toBe(!canEdit)
  })

  test("money pages deny a non-edit account by rendering the gate, not data", async ({
    page,
  }) => {
    const opened = await openRinkScheduling(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for this account")

    const canEdit = await page
      .getByRole("button", { name: /new series/i })
      .isVisible()
      .catch(() => false)
    test.skip(canEdit, "Account is edit-tier; the denial paths need a view-tier account")

    for (const path of ["/invoices", "/insights", "/requests", "/contracts"]) {
      await page.goto(`${CALENDAR}${path}`)
      await expect(page.getByText(/rink schedule not available/i)).toBeVisible()
    }
  })

  test("front desk view is view-tier and renders", async ({ page }) => {
    const opened = await openRinkScheduling(page, "/desk")
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for this account")

    await expect(page.getByRole("heading", { name: /front desk/i })).toBeVisible()
  })

  test("agenda view offers the print button", async ({ page }) => {
    const opened = await openRinkScheduling(page, "?view=list")
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for this account")

    await expect(page.getByRole("button", { name: /^print$/i })).toBeVisible()
  })

  test("dashboard shows the read-only ice schedule widget", async ({ page }) => {
    await page.goto("/dashboard")
    const widget = page.getByText(/ice schedule — today/i)
    const visible = await widget.isVisible().catch(() => false)
    test.skip(
      !visible,
      "TODO(seed): module disabled, no permission, or no active rinks configured",
    )
    // The widget is read-only for every role: a freshness stamp, never a
    // drag handle or context menu.
    await expect(page.getByText(/updated/i).first()).toBeVisible()
  })
})

test.describe("15. Rink Scheduling (admin)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials("admin"), "No credentials for admin")
    await login(page, "admin")
  })

  test("calendar shows the edit surface and the money links", async ({ page }) => {
    const opened = await openRinkScheduling(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for admin")

    await expect(page.getByRole("button", { name: /new series/i })).toBeVisible()
    for (const label of [/invoices/i, /insights/i, /requests/i, /contracts/i, /front desk/i]) {
      await expect(page.getByRole("link", { name: label }).first()).toBeVisible()
    }
  })

  test("booking sheet opens from a slot and closes without writing", async ({ page }) => {
    const opened = await openRinkScheduling(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for admin")

    // The click-to-create overlay labels every slot "Add a booking on <rink>
    // at <time>". Opening the sheet performs only reads (the rate preview);
    // nothing is written until "Create booking", which is never clicked here.
    const slot = page.getByRole("button", { name: /add a booking on/i }).first()
    const slotVisible = await slot.isVisible().catch(() => false)
    test.skip(!slotVisible, "TODO(seed): no rinks configured, so no slots to click")

    await slot.click()
    const sheet = page.getByRole("dialog", { name: /new booking/i })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("button", { name: /create booking/i })).toBeVisible()
    await sheet.getByRole("button", { name: /^close$/i }).first().click()
    await expect(sheet).not.toBeVisible()
  })

  test("money pages render for an edit-tier account", async ({ page }) => {
    for (const [path, heading] of [
      ["/invoices", /invoice/i],
      ["/insights", /insight/i],
      ["/requests", /request/i],
      ["/contracts", /contract/i],
    ] as const) {
      await page.goto(`${CALENDAR}${path}`)
      await expect(page).not.toHaveURL(/\/forbidden|\/login/)
      await expect(page.locator("body")).not.toContainText(
        /application error|something went wrong/i,
      )
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible()
    }
  })

  test("admin console tabs all render", async ({ page }) => {
    for (const tab of ["setup", "rates", "lists", "displays", "settings"]) {
      await page.goto(`/admin/rink-scheduling?tab=${tab}`)
      await expect(page).not.toHaveURL(/\/forbidden|\/login/)
      await expect(page.locator("body")).not.toContainText(
        /application error|something went wrong/i,
      )
    }
  })
})
