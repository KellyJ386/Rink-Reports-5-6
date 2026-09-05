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
 *   - the dashboard calendar is READ-ONLY for every account: all scheduling
 *     writes live on the admin surface at /admin/rink-scheduling/schedule,
 *     so no edit affordance may ever render on /reports/rink-scheduling;
 *   - the edit-tier gates hold together as a set (an account that isn't
 *     offered "Manage schedule" must also be denied the money pages —
 *     asserted as an INVARIANT between affordances, so the spec is
 *     seed-independent);
 *   - the booking sheet opens from a click-to-create slot on the ADMIN
 *     schedule and closes clean — opening the sheet writes nothing;
 *   - the admin console tabs (schedule surface included) all render.
 */

const STAFF: RoleKey = "icetech"

const CALENDAR = "/reports/rink-scheduling"
const ADMIN_SCHEDULE = "/admin/rink-scheduling/schedule"

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

  test("dashboard calendar is read-only for every account", async ({ page }) => {
    const opened = await openRinkScheduling(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for this account")

    // Scheduling writes live in the admin console; this page pins
    // canCreate/canEdit false server-side, so NO edit affordance may render
    // here for ANY account — not the toolbar tools, not the click-to-create
    // slot overlay. This is the strongest seed-independent assertion in the
    // suite: it holds identically for a viewer and a full scheduler.
    for (const label of [/new series/i, /plan cuts/i, /find a slot/i]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0)
    }
    await expect(
      page.getByRole("button", { name: /add a booking on/i }),
    ).toHaveCount(0)
  })

  test("edit-tier affordances gate together, not piecemeal", async ({ page }) => {
    const opened = await openRinkScheduling(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for this account")

    // The "Manage schedule" link (edit) and the money pages (edit) are gated
    // by the same permission model. Whatever this account is seeded as, they
    // must AGREE: an account offered the manage link must be admitted to the
    // invoices page, and an account not offered it must be refused outright
    // when it navigates directly — route placement is UX, never the
    // authorization boundary.
    const canEdit = await page
      .getByRole("link", { name: /manage schedule/i })
      .isVisible()
      .catch(() => false)

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
      .getByRole("link", { name: /manage schedule/i })
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

  /** Opens the admin scheduling surface; false when the console or the module
   *  grant is missing for the account. */
  async function openAdminSchedule(
    page: import("@playwright/test").Page,
  ): Promise<boolean> {
    await page.goto(ADMIN_SCHEDULE)
    if (/\/forbidden|\/login/.test(page.url())) return false
    const gated = page.getByText(/rink scheduling permission needed/i)
    if (await gated.isVisible().catch(() => false)) return false
    return page
      .getByRole("heading", { name: /ice schedule/i })
      .isVisible()
      .catch(() => false)
  }

  test("admin schedule shows the edit surface and the money links", async ({ page }) => {
    const opened = await openAdminSchedule(page)
    test.skip(!opened, "TODO(seed): rink_scheduling not enabled for admin")

    await expect(page.getByRole("button", { name: /new series/i })).toBeVisible()
    for (const label of [/invoices/i, /insights/i, /requests/i, /contracts/i, /front desk/i]) {
      await expect(page.getByRole("link", { name: label }).first()).toBeVisible()
    }
  })

  test("booking sheet opens from an admin slot and closes without writing", async ({ page }) => {
    const opened = await openAdminSchedule(page)
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
    // The scheduling surface is a sibling route, not a ?tab=, but it lives in
    // the same tab bar and must render for an admin without a crash.
    await page.goto(ADMIN_SCHEDULE)
    await expect(page).not.toHaveURL(/\/forbidden|\/login/)
    await expect(page.locator("body")).not.toContainText(
      /application error|something went wrong/i,
    )
  })
})
