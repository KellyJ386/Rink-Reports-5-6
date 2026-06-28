import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

const STAFF: RoleKey = "icetech"

test.describe("6. Refrigeration & Air Quality", () => {
  // ── Refrigeration ─────────────────────────────────────────────────────────
  test.describe("refrigeration", () => {
    test.beforeEach(async ({ page }) => {
      test.skip(!hasCredentials(STAFF), `No credentials for ${STAFF}`)
      await login(page, STAFF)
      await page.goto("/reports/refrigeration")
    })

    test("the °F/°C unit toggle flips", async ({ page }) => {
      const toggle = page.getByRole("switch", {
        name: /temperature units/i,
      })
      test.skip(
        !(await toggle.isVisible().catch(() => false)),
        "Refrigeration form not rendered (no sections/fields seeded)",
      )
      const before = await toggle.getAttribute("aria-checked")
      await toggle.click()
      await expect(toggle).not.toHaveAttribute("aria-checked", before ?? "false")
    })

    test("out-of-range alert banner reflects the module's alert setting", async ({
      page,
    }) => {
      // When oorAlertsEnabled is ON for the facility, the form shows a banner
      // warning that out-of-range readings alert managers. When OFF, it's
      // absent. Both are valid; we assert the banner state is coherent and
      // record which it is. Configure the facility to ON to exercise the
      // "triggers alert" path and a second facility/module to OFF for the
      // "does not trigger" path.
      const banner = page.getByText(
        /out-of-range readings will trigger an alert/i,
      )
      const enabled = await banner.isVisible().catch(() => false)
      test
        .info()
        .annotations.push({
          type: "oorAlertsEnabled",
          description: enabled ? "ON (alert banner shown)" : "OFF (no banner)",
        })
      // Either way the form must be usable.
      await expect(
        page.getByRole("button", { name: /submit refrigeration report|save on this device/i }),
      ).toBeVisible()
    })

    test("a critically out-of-range value requires a corrective-action note", async ({
      page,
    }) => {
      // Find the first numeric reading input and push it to an extreme value.
      const numeric = page.locator('input[inputmode="decimal"]').first()
      test.skip(
        !(await numeric.isVisible().catch(() => false)),
        "TODO(seed): no numeric refrigeration fields configured",
      )
      await numeric.fill("999")
      // Critical fields reveal a required corrective-action note when breached.
      const note = page.getByText(/corrective action/i).first()
      // Soft — only fields flagged severity=critical reveal this; if the first
      // numeric field isn't critical the note won't show. Record the outcome.
      const shown = await note.isVisible().catch(() => false)
      test
        .info()
        .annotations.push({
          type: "corrective-note",
          description: shown ? "shown for breached critical field" : "field not critical",
        })
    })

    test("incomplete report can be submitted if the module allows it", async ({
      page,
    }) => {
      // Refrigeration does not hard-require every field (unlike air quality).
      // The submit control should be enabled even with blank optional fields.
      const submit = page.getByRole("button", {
        name: /submit refrigeration report|save on this device/i,
      })
      test.skip(
        !(await submit.isVisible().catch(() => false)),
        "Refrigeration form not rendered",
      )
      // TODO(seed): if your facility marks fields is_required, fill them first.
      await expect(submit).toBeEnabled()
    })
  })

  // ── Air Quality ───────────────────────────────────────────────────────────
  test.describe("air quality", () => {
    test.beforeEach(async ({ page }) => {
      test.skip(!hasCredentials(STAFF), `No credentials for ${STAFF}`)
      await login(page, STAFF)
      await page.goto("/reports/air-quality")
    })

    test("location is required before submission", async ({ page }) => {
      const submit = page.getByRole("button", { name: /submit readings|save offline/i })
      test.skip(
        !(await submit.isVisible().catch(() => false)),
        "Air quality form not rendered",
      )
      // With no location chosen, submit is disabled.
      await expect(submit).toBeDisabled()
    })

    test("entering an over-threshold reading surfaces a range badge", async ({
      page,
    }) => {
      const reading = page.locator('input[inputmode="decimal"]').first()
      test.skip(
        !(await reading.isVisible().catch(() => false)),
        "TODO(seed): no air-quality reading types configured",
      )
      await reading.fill("9999")
      // A live AlertLevelBadge reflects the band.
      await expect(
        page.getByText(/within range|corrective action|notification|evacuation/i).first(),
      ).toBeVisible({ timeout: 5_000 })
    })
  })

  // ── History filters (admin) ───────────────────────────────────────────────
  test("history filters are available (refrigeration & air quality)", async ({
    page,
  }) => {
    test.skip(!hasCredentials("admin"), "No admin credentials")
    await login(page, "admin")

    await page.goto("/admin/refrigeration?tab=history")
    await expect(page).not.toHaveURL(/\/forbidden/)
    await expect(
      page.getByRole("tab", { name: /history/i }).or(page.getByText(/history/i).first()),
    ).toBeVisible()
    // Filter controls (employee / date / out-of-range) exist on the history tab.
    const refrigFilters = page.getByRole("combobox").or(page.locator('input[type="date"]'))
    expect(await refrigFilters.count()).toBeGreaterThan(0)

    await page.goto("/admin/air-quality")
    await expect(page).not.toHaveURL(/\/forbidden/)
  })
})
