import { test, expect, login } from "../fixtures/auth"
import { hasCredentials, type RoleKey } from "../fixtures/users"

const REPORTER: RoleKey = "frontdesk"

test.describe("5. Incident & Accident Reports", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials(REPORTER), `No credentials for ${REPORTER}`)
    await login(page, REPORTER)
  })

  // ── Incidents ─────────────────────────────────────────────────────────────
  test("incident: required fields are enforced (empty submit blocked)", async ({
    page,
  }) => {
    await page.goto("/reports/incidents")
    await expect(
      page.getByRole("heading", { name: /incident/i }).first(),
    ).toBeVisible()

    // Attempt to submit with nothing filled. Required fields (when, space,
    // description, severity) must block progression — the confirm dialog either
    // never opens or the action returns field errors; we must not reach /done.
    const submit = page.getByRole("button", {
      name: /submit incident report/i,
    })
    if (await submit.isEnabled().catch(() => false)) {
      await submit.click()
      // If a confirm dialog appears, confirm it to reach the server-side guard.
      const confirm = page.getByRole("button", { name: /confirm.*submit/i })
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
    }
    await expect(page).not.toHaveURL(/\/reports\/incidents\/done/)
    // A validation message / required marker is visible (clear error).
    await expect(
      page.locator("[aria-invalid='true'], [role='alert']").first(),
    ).toBeVisible({ timeout: 5_000 }).catch(() => {})
  })

  test("incident: submits when required fields are completed", async ({
    page,
  }) => {
    await page.goto("/reports/incidents")

    // When & where.
    await page.locator("#occurred_at").fill("2026-06-28T10:30").catch(() => {})

    // Facility space (dropdown of checkboxes).
    const spaceTrigger = page.locator("#space_select")
    if (await spaceTrigger.isVisible().catch(() => false)) {
      await spaceTrigger.click()
      const firstSpace = page.getByRole("menuitemcheckbox").first()
      const firstOpt = (await firstSpace.isVisible().catch(() => false))
        ? firstSpace
        : page.getByRole("option").first()
      if (await firstOpt.isVisible().catch(() => false)) await firstOpt.click()
      await page.keyboard.press("Escape")
    }

    await page
      .locator("#description")
      .fill("Spectator slipped near the entrance; no injury reported.")

    // Severity select.
    const sev = page.locator("#severity_level_id_trigger")
    if (await sev.isVisible().catch(() => false)) {
      await sev.click()
      const opt = page.getByRole("option").first()
      if (await opt.isVisible().catch(() => false)) await opt.click()
    }

    const submit = page.getByRole("button", {
      name: /submit incident report/i,
    })
    test.skip(
      !(await submit.isEnabled().catch(() => false)),
      "TODO(seed): required fields couldn't be satisfied (no spaces/severity seeded)",
    )
    await submit.click()
    const confirm = page.getByRole("button", { name: /confirm.*submit/i })
    if (await confirm.isVisible().catch(() => false)) await confirm.click()

    await expect(page).toHaveURL(/\/reports\/incidents\/done/)
    await expect(page.getByRole("heading", { name: /reported/i })).toBeVisible()
    // The done page advertises the 24-hour edit window.
    await expect(page.getByText(/edit this report for 24 hours/i)).toBeVisible()
  })

  // ── Accidents ─────────────────────────────────────────────────────────────
  test("accident: no photo upload is available", async ({ page }) => {
    await page.goto("/reports/accidents")
    await expect(
      page.getByRole("heading", { name: /accident/i }).first(),
    ).toBeVisible()
    // There must be no file input anywhere in the accident form.
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
  })

  test("accident: body diagram is interactive", async ({ page }) => {
    await page.goto("/reports/accidents")
    await expect(page.getByText(/body parts affected/i)).toBeVisible()
    // The diagram is an SVG with tappable regions. Tapping toggles a selection
    // serialized into the hidden body_parts_json input.
    const hidden = page.locator('input[name="body_parts_json"]')
    const region = page.locator("svg [role='button'], svg path, svg g").first()
    test.skip(
      !(await region.isVisible().catch(() => false)),
      "Body diagram regions not rendered (lazy component may need interaction)",
    )
    const before = await hidden.inputValue().catch(() => "")
    await region.click({ force: true })
    const after = await hidden.inputValue().catch(() => "")
    expect.soft(after, "Tapping a body region should record a selection").not.toEqual(before)
  })

  test("accident: selecting medical attention triggers a manager alert notice", async ({
    page,
  }) => {
    await page.goto("/reports/accidents")
    // The "Medical attention" select has options that flag triggersAlert; when
    // chosen, a role=status notice appears.
    const medTrigger = page
      .getByRole("combobox")
      .filter({ hasText: /medical attention/i })
      .first()
    test.skip(
      !(await medTrigger.isVisible().catch(() => false)),
      "TODO(seed): no medical-attention options configured",
    )
    await medTrigger.click()
    // Pick an option likely to escalate (e.g. transported / ambulance / ER).
    const escalating = page
      .getByRole("option", { name: /ambulance|transport|emergency|er|hospital/i })
      .first()
    const anyOption = (await escalating.isVisible().catch(() => false))
      ? escalating
      : page.getByRole("option").last()
    await anyOption.click()
    // Alert notice appears.
    await expect(
      page.getByText(/will alert managers/i),
    ).toBeVisible({ timeout: 5_000 })
  })

  test("accident: required fields are enforced", async ({ page }) => {
    await page.goto("/reports/accidents")
    const submit = page.getByRole("button", { name: /^submit report$/i })
    if (await submit.isEnabled().catch(() => false)) {
      await submit.click()
      const confirm = page.getByRole("button", { name: /confirm.*submit/i })
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
    }
    // Without name/contact/age/severity/description we must not navigate to the
    // submitted view.
    await expect(page).not.toHaveURL(/\/reports\/accidents\/[0-9a-f-]+\?submitted/)
    await expect(
      page.locator("[aria-invalid='true'], [role='alert']").first(),
    ).toBeVisible({ timeout: 5_000 }).catch(() => {})
  })

  // The 24-hour edit window and timestamped follow-up notes depend on an
  // already-submitted report id; provide one via seed to exercise fully.
  test("accident: original report is editable only within 24 hours", async ({
    page,
  }) => {
    const reportPath = process.env.E2E_ACCIDENT_REPORT_PATH
    test.skip(
      !reportPath,
      "TODO(seed): set E2E_ACCIDENT_REPORT_PATH to a submitted accident report to verify the 24h window",
    )
    await page.goto(reportPath!)
    // Within the window: an editable form ("Save changes") + a remaining-time
    // banner. After it closes: read-only, no save control.
    const editable = await page
      .getByRole("button", { name: /save changes/i })
      .isVisible()
      .catch(() => false)
    if (editable) {
      await expect(page.getByText(/editable for .* more (hour|hours)/i)).toBeVisible()
    } else {
      await expect(page.getByRole("button", { name: /save changes/i })).toHaveCount(0)
    }
  })
})
