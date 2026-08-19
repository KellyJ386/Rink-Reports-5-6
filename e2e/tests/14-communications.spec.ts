import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

/**
 * Communications owns the whole notification and email pipeline and had no
 * browser coverage. Unlike Scheduling, its staff writes are plain table
 * inserts rather than online-only RPCs, so this spec can exercise the real
 * compose flow end to end.
 *
 * It deliberately does NOT drive the admin Broadcast tab: sending a broadcast
 * queues real email to real staff, which is not something a test suite should
 * do against a shared environment.
 */

const STAFF: RoleKey = "icetech"

async function openInbox(
  page: import("@playwright/test").Page,
  view: "alerts" | "messages" | "sent" = "alerts",
): Promise<boolean> {
  await page.goto(`/reports/communications?inbox=${view}`)
  const denied = page.getByText(/no permission|account not set up/i)
  if (await denied.isVisible().catch(() => false)) return false
  return page
    .getByRole("heading", { name: /communications/i })
    .isVisible()
    .catch(() => false)
}

test.describe("14. Communications (staff)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(STAFF), `No credentials for ${STAFF}`)
    await login(page, STAFF)
  })

  test("inbox renders with its alerts and messages tabs", async ({ page }) => {
    const opened = await openInbox(page)
    test.skip(!opened, "TODO(seed): communications not enabled for this account")

    const nav = page.getByRole("navigation", { name: /inbox/i })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole("link", { name: /alerts/i })).toBeVisible()
    await expect(nav.getByRole("link", { name: /messages/i })).toBeVisible()
  })

  test("switching to the messages tab changes the view, not just the URL", async ({ page }) => {
    const opened = await openInbox(page)
    test.skip(!opened, "TODO(seed): communications not enabled for this account")

    await page
      .getByRole("navigation", { name: /inbox/i })
      .getByRole("link", { name: /messages/i })
      .click()
    await expect(page).toHaveURL(/inbox=messages/)
    // Either real messages or the honest empty state — never a crash.
    const list = page.getByText(/no messages match your filters/i)
    const rendered =
      (await list.isVisible().catch(() => false)) ||
      (await page.getByRole("link").first().isVisible().catch(() => false))
    expect(rendered).toBe(true)
  })

  test("an alert drilldown opens and shows its acknowledge affordance when required", async ({
    page,
  }) => {
    const opened = await openInbox(page, "alerts")
    test.skip(!opened, "TODO(seed): communications not enabled for this account")

    const firstAlert = page.locator('a[href*="alert="]').first()
    test.skip(
      !(await firstAlert.isVisible().catch(() => false)),
      "TODO(seed): no alerts in this facility's inbox",
    )
    await firstAlert.click()
    await expect(page).toHaveURL(/alert=/)

    // Acknowledgement is an explicit action — opening an alert must never
    // consume it on the reader's behalf.
    const ack = page.getByRole("button", { name: /acknowledge/i })
    if (await ack.isVisible().catch(() => false)) {
      await expect(ack).toBeEnabled()
    }
  })

  test("compose validates a required body before sending", async ({ page }) => {
    await page.goto("/reports/communications/compose")
    const denied = page.getByText(/no permission|account not set up/i)
    test.skip(
      await denied.isVisible().catch(() => false),
      "TODO(seed): account lacks communications submit permission",
    )

    const body = page.getByLabel(/^message/i)
    await expect(body).toBeVisible()

    // Submitting empty must not create a message.
    await page.getByRole("button", { name: /send message|save offline/i }).click()
    await expect(page).toHaveURL(/\/compose/)
  })

  test("compose sends a message and lands on the done screen", async ({ page }) => {
    await page.goto("/reports/communications/compose")
    const denied = page.getByText(/no permission|account not set up/i)
    test.skip(
      await denied.isVisible().catch(() => false),
      "TODO(seed): account lacks communications submit permission",
    )

    const recipients = page.getByRole("combobox").first()
    test.skip(
      !(await recipients.isVisible().catch(() => false)),
      "TODO(seed): no messageable groups configured",
    )

    await page.getByLabel(/subject/i).fill("E2E check — safe to ignore")
    await page
      .getByPlaceholder(/type your message/i)
      .fill("Automated end-to-end check. No action needed.")
    await page.getByRole("button", { name: /send message|save offline/i }).click()

    await expect(page).toHaveURL(/\/compose\/done|\/reports\/communications/, {
      timeout: 15_000,
    })
  })
})

test.describe("14. Communications (admin console)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials("admin"), "No credentials for admin")
    await login(page, "admin")
  })

  test("every admin tab renders", async ({ page }) => {
    // Broadcast is loaded but never submitted — sending queues real email.
    for (const tab of [
      "inbox",
      "broadcast",
      "groups",
      "templates",
      "routing",
      "reminders",
      "deliveries",
      "audit",
    ]) {
      await page.goto(`/admin/communications?tab=${tab}`)
      await expect(page).not.toHaveURL(/\/forbidden|\/login/)
      await expect(page.locator("body")).not.toContainText(
        /application error|something went wrong/i,
      )
    }
  })

  test("staff are denied the communications admin console", async ({ page }) => {
    test.skip(!hasCredentials(STAFF), `No credentials for ${STAFF}`)
    await login(page, STAFF)
    await page.goto("/admin/communications")
    await expect(page).toHaveURL(/\/forbidden|\/login/)
  })
})
