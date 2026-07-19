import fs from "node:fs"
import path from "node:path"

import { test as base, expect, type Page } from "@playwright/test"

import {
  USERS,
  passwordFor,
  hasCredentials,
  type RoleKey,
} from "./users"

const STORAGE_DIR = path.resolve(__dirname, "..", ".auth")

function storagePath(role: RoleKey): string {
  return path.join(STORAGE_DIR, `${role}.json`)
}

/**
 * Perform a real UI login as `role`. Asserts the post-login landing path.
 * Throws (rather than skips) if credentials are missing — callers that want a
 * graceful skip should guard with `ensureCreds()` first.
 */
export async function login(page: Page, role: RoleKey): Promise<void> {
  const user = USERS[role]
  const password = passwordFor(role)
  if (!password) {
    throw new Error(
      `Missing password for role "${role}" (set ${user.passwordEnv} in e2e/.env.e2e.local)`,
    )
  }

  // Session reuse: a fresh UI login for every test hammers the Supabase
  // password-grant endpoint (~30 sign-ins / 5 min / IP) and the whole suite
  // collapses into rate-limit failures on CI, where every test shares one IP.
  // The first login per role goes through the real form (so the login flow
  // itself stays covered — spec 01 runs first on an empty cache); afterwards
  // the cookies are cached on disk and replayed into each test's fresh
  // context.
  const cached = storagePath(role)
  if (fs.existsSync(cached)) {
    try {
      const state = JSON.parse(fs.readFileSync(cached, "utf8")) as {
        cookies?: Parameters<
          ReturnType<Page["context"]>["addCookies"]
        >[0]
      }
      if (state.cookies?.length) {
        await page.context().addCookies(state.cookies)
        await page.goto(user.expectedLandingPath)
        if (!page.url().includes("/login")) {
          await expect(page).toHaveURL(new RegExp(user.expectedLandingPath))
          return
        }
        // Session expired/invalid — fall through to a real login.
        await page.context().clearCookies()
      }
    } catch {
      // Corrupt cache — fall through to a real login.
    }
  }

  await page.goto("/login")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: /sign in/i }).click()

  // Middleware (src/proxy.ts) redirects an authenticated user away from /login
  // to /dashboard; loginAction also redirects to /dashboard.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  })
  await expect(page).toHaveURL(new RegExp(user.expectedLandingPath))

  // Cache the session for reuse by later tests (see note above).
  fs.mkdirSync(STORAGE_DIR, { recursive: true })
  await page.context().storageState({ path: storagePath(role) })
}

export async function logout(page: Page): Promise<void> {
  // The /logout route accepts a POST; navigating then submitting the sign-out
  // form is the most robust path across the staff and admin shells.
  await page.goto("/dashboard")
  const signOut = page.getByRole("button", { name: /sign out/i }).first()
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click()
    await page.waitForURL(/\/login/, { timeout: 10_000 }).catch(() => {})
  } else {
    await page.request.post("/logout").catch(() => {})
  }
}

/**
 * Returns a storageState path for `role`, logging in once and caching the
 * cookies/localStorage to disk so repeated tests in a run reuse the session.
 * Returns null when credentials are absent.
 */
export async function storageStateForRole(
  page: Page,
  role: RoleKey,
): Promise<string | null> {
  if (!hasCredentials(role)) return null
  const file = storagePath(role)
  fs.mkdirSync(STORAGE_DIR, { recursive: true })
  await login(page, role)
  await page.context().storageState({ path: file })
  return file
}

/**
 * Test-level guard: skips with a clear annotation when a role's password env
 * var isn't set, so the suite stays green against an unseeded environment and
 * self-documents what staging data it needs.
 */
export function ensureCreds(role: RoleKey): void {
  base.skip(
    !hasCredentials(role),
    `No credentials for "${role}" — set ${USERS[role].passwordEnv} in e2e/.env.e2e.local`,
  )
}

/**
 * Extended test with a `loginAs` helper and a `roleSession` fixture that yields
 * an already-authenticated page for a parameterized role. Most specs use the
 * plain `test` + `loginAs(page, role)`; use `authedPage` when you want the
 * session set up for you.
 */
export const test = base.extend<{
  loginAs: (role: RoleKey) => Promise<void>
}>({
  // Param is named `provide` (not `use`) so eslint's react-hooks/rules-of-hooks
  // doesn't mistake Playwright's fixture callback for the React `use` hook.
  loginAs: async ({ page }, provide) => {
    await provide((role: RoleKey) => login(page, role))
  },
})

export { expect }
