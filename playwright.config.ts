import { defineConfig, devices } from "@playwright/test"
import { loadE2EEnv } from "./e2e/fixtures/env"

// Load e2e/.env.e2e (and .env.e2e.local) before reading process.env below.
loadE2EEnv()

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

// When E2E_START_SERVER=1 Playwright will boot `pnpm start` itself. Against a
// real staging deployment leave it unset and point E2E_BASE_URL at the host.
const startLocalServer = process.env.E2E_START_SERVER === "1"

export default defineConfig({
  testDir: "./e2e/tests",
  // Per-test timeout. Report PDF/Excel generation and Supabase round-trips can
  // be slow, so this is generous.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Staging data is shared/mutable — never let two workers race the same
  // facility. Keep ordering deterministic; bump locally with --workers.
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // ── Reporters: HTML (browsable), JSON (machine-readable), a list line for
  // the console, plus our markdown summary reporter that powers the final
  // "test report" deliverable. ────────────────────────────────────────────
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/report/html", open: "never" }],
    ["json", { outputFile: "e2e/report/results.json" }],
    ["./e2e/utils/markdown-reporter.ts", { outputFile: "e2e/report/REPORT.md" }],
  ],
  outputDir: "e2e/report/artifacts",
  use: {
    baseURL,
    // Capture-on-failure: screenshots + traces + video are saved under
    // outputDir and surfaced in the HTML report and markdown summary.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile layout coverage (section 10). Tagged tests opt in via @mobile.
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  ...(startLocalServer
    ? {
        webServer: {
          command: "pnpm start",
          url: baseURL,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
        },
      }
    : {}),
})
