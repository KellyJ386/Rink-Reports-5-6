import fs from "node:fs"
import path from "node:path"

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter"

interface Options {
  outputFile?: string
}

interface Row {
  title: string
  file: string
  status: TestResult["status"] | "skipped"
  durationMs: number
  errors: string[]
  attachments: { name: string; path?: string }[]
  annotations: { type: string; description?: string }[]
}

/**
 * Emits the final human-readable test report (the section-10 deliverable):
 * a markdown file summarizing passed / failed / skipped tests, links to
 * failure screenshots & traces, and an auto-generated recommendations block.
 */
export default class MarkdownReporter implements Reporter {
  private rows: Row[] = []
  private outputFile: string
  private startedAt = 0

  constructor(options: Options = {}) {
    this.outputFile = options.outputFile ?? "e2e/report/REPORT.md"
  }

  onBegin(): void {
    this.startedAt = Date.now()
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.rows.push({
      title: test.titlePath().slice(1).join(" › "),
      file: path.relative(process.cwd(), test.location.file),
      status: result.status,
      durationMs: result.duration,
      errors: result.errors.map((e) => stripAnsi(e.message ?? String(e))),
      attachments: result.attachments
        .filter((a) => a.path || a.name)
        .map((a) => ({ name: a.name, path: a.path })),
      annotations: test.annotations,
    })
  }

  async onEnd(result: FullResult): Promise<void> {
    const total = this.rows.length
    const passed = this.rows.filter((r) => r.status === "passed").length
    const failed = this.rows.filter(
      (r) => r.status === "failed" || r.status === "timedOut",
    ).length
    const skipped = this.rows.filter((r) => r.status === "skipped").length
    const flaky = this.rows.filter((r) => r.status === "interrupted").length
    const wall = ((Date.now() - this.startedAt) / 1000).toFixed(1)

    const lines: string[] = []
    lines.push("# Rink Reports — E2E Test Report")
    lines.push("")
    lines.push(`Run finished with status: **${result.status.toUpperCase()}**`)
    lines.push("")
    lines.push("## Summary")
    lines.push("")
    lines.push("| Result | Count |")
    lines.push("| --- | --- |")
    lines.push(`| ✅ Passed | ${passed} |`)
    lines.push(`| ❌ Failed | ${failed} |`)
    lines.push(`| ⏭️ Skipped | ${skipped} |`)
    if (flaky) lines.push(`| ⚠️ Interrupted | ${flaky} |`)
    lines.push(`| **Total** | **${total}** |`)
    lines.push("")
    lines.push(`Wall-clock: ${wall}s`)
    lines.push("")

    // ── Failures with screenshots ───────────────────────────────────────────
    const failures = this.rows.filter(
      (r) => r.status === "failed" || r.status === "timedOut",
    )
    lines.push("## Failed tests")
    lines.push("")
    if (failures.length === 0) {
      lines.push("_None._")
    } else {
      for (const f of failures) {
        lines.push(`### ❌ ${f.title}`)
        lines.push(`- File: \`${f.file}\``)
        lines.push(`- Duration: ${(f.durationMs / 1000).toFixed(1)}s`)
        const shots = f.attachments.filter(
          (a) => a.name === "screenshot" || /\.png$/.test(a.path ?? ""),
        )
        if (shots.length) {
          lines.push(`- Screenshots:`)
          for (const s of shots) {
            const rel = s.path ? path.relative(process.cwd(), s.path) : s.name
            lines.push(`  - \`${rel}\``)
          }
        }
        const traces = f.attachments.filter((a) => /\.zip$/.test(a.path ?? ""))
        if (traces.length) {
          lines.push(`- Trace: \`${traces.map((t) => path.relative(process.cwd(), t.path!)).join("`, `")}\``)
        }
        if (f.errors.length) {
          lines.push("")
          lines.push("```")
          lines.push(f.errors.join("\n").slice(0, 1200))
          lines.push("```")
        }
        lines.push("")
      }
    }

    // ── Skipped (what staging data/credentials are missing) ─────────────────
    const skips = this.rows.filter((r) => r.status === "skipped")
    lines.push("## Skipped tests")
    lines.push("")
    if (skips.length === 0) {
      lines.push("_None._")
    } else {
      lines.push(
        "Skips are usually missing credentials or staging seed data. Reasons:",
      )
      lines.push("")
      for (const s of skips) {
        const reason =
          s.annotations.find((a) => a.type === "skip")?.description ??
          "see annotation"
        lines.push(`- \`${s.title}\` — ${reason}`)
      }
    }
    lines.push("")

    // ── All results table ───────────────────────────────────────────────────
    lines.push("## All results")
    lines.push("")
    lines.push("| Status | Test | Duration |")
    lines.push("| --- | --- | --- |")
    for (const r of this.rows) {
      lines.push(
        `| ${icon(r.status)} | ${escapePipes(r.title)} | ${(r.durationMs / 1000).toFixed(1)}s |`,
      )
    }
    lines.push("")

    // ── Recommendations ─────────────────────────────────────────────────────
    lines.push("## Recommendations")
    lines.push("")
    for (const rec of recommendations({ failed, skipped, failures })) {
      lines.push(`- ${rec}`)
    }
    lines.push("")
    lines.push(
      "_Browse the full interactive report at `e2e/report/html/index.html` " +
        "(`pnpm exec playwright show-report e2e/report/html`)._",
    )
    lines.push("")

    const outPath = path.resolve(this.outputFile)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, lines.join("\n"), "utf8")
    console.log(`\nMarkdown report written to ${path.relative(process.cwd(), outPath)}`)
  }
}

function icon(status: Row["status"]): string {
  switch (status) {
    case "passed":
      return "✅"
    case "skipped":
      return "⏭️"
    case "failed":
    case "timedOut":
      return "❌"
    default:
      return "⚠️"
  }
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|")
}

function stripAnsi(s: string): string {
  return s.replace(/\[[0-9;]*m/g, "")
}

function recommendations(ctx: {
  failed: number
  skipped: number
  failures: Row[]
}): string[] {
  const recs: string[] = []
  if (ctx.failed === 0 && ctx.skipped === 0) {
    recs.push("All tests passed against the configured environment — no action needed.")
    return recs
  }
  if (ctx.skipped > 0) {
    recs.push(
      `${ctx.skipped} test(s) were skipped — set the missing \`E2E_*_PASSWORD\` / seed-data env vars in \`e2e/.env.e2e.local\` to run them.`,
    )
  }
  if (ctx.failures.some((f) => /forbidden|admin|permission/i.test(f.title))) {
    recs.push(
      "Permission/RLS failures detected — verify the affected user's `user_permissions` rows and facility_id in staging.",
    )
  }
  if (ctx.failures.some((f) => /alert|out-of-range|communication/i.test(f.title))) {
    recs.push(
      "Alert-related failures — confirm module alert settings (e.g. refrigeration `oorAlertsEnabled`) match what the test expects.",
    )
  }
  if (ctx.failures.some((f) => /console error/i.test(f.title))) {
    recs.push(
      "Console-error failures — inspect the attached `console-errors.txt`; tune `e2e/utils/console-guard.ts` IGNORE list only for genuine third-party noise.",
    )
  }
  if (ctx.failed > 0) {
    recs.push(
      "Open the failing tests' traces (`pnpm exec playwright show-trace <trace.zip>`) to step through the exact failure point.",
    )
  }
  return recs
}
