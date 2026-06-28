import { test, expect, login } from "../fixtures/auth"
import {
  hasCredentials,
  facilityBHasCredentials,
  FACILITY_B_USER,
} from "../fixtures/users"
import { isAccessDenied } from "../utils/nav"

// The seven primary accounts belong to Facility A; FACILITY_B_USER belongs to
// Facility B. A known Facility-B report URL is supplied via
// E2E_FACILITY_B_REPORT_PATH.
const FACILITY_A_ROLE = "admin" as const
const facilityBReportPath = process.env.E2E_FACILITY_B_REPORT_PATH

test.describe("9. Multi-tenant security", () => {
  test("Facility B's report exists for a Facility B user (precondition)", async ({
    page,
  }) => {
    test.skip(
      !facilityBHasCredentials() || !facilityBReportPath,
      "TODO(seed): set E2E_FACILITY_B_PASSWORD + E2E_FACILITY_B_REPORT_PATH (and create Facility B)",
    )
    // Log in as the Facility B user via raw form (not in the role registry).
    await page.goto("/login")
    await page.getByLabel("Email").fill(FACILITY_B_USER.email)
    await page.getByLabel("Password").fill(process.env[FACILITY_B_USER.passwordEnv]!)
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL((u) => !u.pathname.startsWith("/login"))

    // The Facility B user CAN open their own report — proving the URL is valid,
    // so the Facility A denial below is genuine isolation, not a dead link.
    const denied = await isAccessDenied(page, facilityBReportPath!)
    expect(denied, "Facility B user should see their own report").toBeFalsy()
  })

  test("Facility A user cannot open Facility B's report via direct URL", async ({
    page,
  }) => {
    test.skip(!hasCredentials(FACILITY_A_ROLE), "No Facility A (admin) credentials")
    test.skip(
      !facilityBReportPath,
      "TODO(seed): set E2E_FACILITY_B_REPORT_PATH to a Facility B report URL",
    )
    await login(page, FACILITY_A_ROLE)

    // Direct URL access to another facility's report must be denied (RLS makes
    // the row invisible → not-found / forbidden / empty), NOT rendered.
    const denied = await isAccessDenied(page, facilityBReportPath!)
    expect(
      denied,
      "Facility A user must NOT see Facility B's report content",
    ).toBeTruthy()
  })

  test("data request for Facility B is denied by RLS (no cross-tenant rows)", async ({
    page,
  }) => {
    test.skip(!hasCredentials(FACILITY_A_ROLE), "No Facility A (admin) credentials")
    await login(page, FACILITY_A_ROLE)

    // As an authenticated Facility A user, request the Facility B report path's
    // server response directly. RLS should yield no Facility B content: a
    // not-found/forbidden status, or a page without the report body.
    test.skip(
      !facilityBReportPath,
      "TODO(seed): set E2E_FACILITY_B_REPORT_PATH",
    )
    const resp = await page.request.get(facilityBReportPath!)
    // Server-rendered pages may still return 200 with a not-found UI; accept
    // either an explicit deny status or a body that doesn't leak B's data.
    if (resp.status() === 200) {
      const body = await resp.text()
      expect(
        /not found|access denied|forbidden|no access/i.test(body),
        "200 response must render a denial, not Facility B data",
      ).toBeTruthy()
    } else {
      expect([401, 403, 404]).toContain(resp.status())
    }
  })

  test("RLS isolation note", async () => {
    // Cross-tenant row isolation at the database layer is exhaustively covered
    // by the SQL harness (supabase/tests/rls_isolation.sql) run in CI. These
    // browser tests cover the user-facing surface; the SQL harness is the
    // authoritative RLS regression suite.
    test
      .info()
      .annotations.push({
        type: "rls",
        description:
          "Authoritative cross-tenant RLS coverage lives in supabase/tests/rls_isolation.sql",
      })
    expect(true).toBeTruthy()
  })
})
