import { type Page, type TestInfo, expect } from "@playwright/test"

/**
 * Attaches console + page-error listeners and returns a collector. Used by the
 * "no console errors" quality checks (section 10) and can be dropped into any
 * spec to assert a flow produced no errors.
 *
 * Known third-party noise (e.g. PostHog network blips, favicon 404s) is
 * filtered via IGNORE patterns so real app errors aren't drowned out. Tune
 * these to your environment rather than loosening the assertion.
 */
const IGNORE: RegExp[] = [
  /favicon\.ico/i,
  /Failed to load resource: the server responded with a status of 404/i,
  /posthog/i,
  /\[Fast Refresh\]/i,
  /Download the React DevTools/i,
  // Service worker registration noise in non-PWA test contexts.
  /ServiceWorker/i,
]

export interface ConsoleCollector {
  readonly errors: string[]
  assertClean(testInfo?: TestInfo): Promise<void>
}

export function watchConsole(page: Page): ConsoleCollector {
  const errors: string[] = []

  const record = (msg: string) => {
    if (IGNORE.some((re) => re.test(msg))) return
    errors.push(msg)
  }

  page.on("console", (msg) => {
    if (msg.type() === "error") record(`console.error: ${msg.text()}`)
  })
  page.on("pageerror", (err) => record(`pageerror: ${err.message}`))
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "unknown"
    // Ignore intentional aborts.
    if (/aborted/i.test(failure)) return
    record(`requestfailed: ${req.method()} ${req.url()} (${failure})`)
  })

  return {
    errors,
    async assertClean(testInfo?: TestInfo) {
      if (errors.length && testInfo) {
        await testInfo.attach("console-errors.txt", {
          body: errors.join("\n"),
          contentType: "text/plain",
        })
      }
      expect(errors, `Unexpected console/page errors:\n${errors.join("\n")}`).toEqual([])
    },
  }
}
