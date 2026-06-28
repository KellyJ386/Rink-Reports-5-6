import fs from "node:fs"
import path from "node:path"

/**
 * Minimal, dependency-free .env loader for the e2e suite.
 *
 * Loads, in order (later files win, but never overwrite an already-set
 * process.env value so real shell/CI env always takes precedence):
 *   1. e2e/.env.e2e
 *   2. e2e/.env.e2e.local   (gitignored — put real staging passwords here)
 *
 * We intentionally do not pull in `dotenv` to keep the test tooling free of
 * extra dependencies (mirrors how vitest.config.ts stays lean).
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return out
  const raw = fs.readFileSync(filePath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

let loaded = false

export function loadE2EEnv(): void {
  if (loaded) return
  loaded = true
  const dir = path.resolve(__dirname, "..")
  for (const file of [".env.e2e", ".env.e2e.local"]) {
    const parsed = parseEnvFile(path.join(dir, file))
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v
    }
  }
}
