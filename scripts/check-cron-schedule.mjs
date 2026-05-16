#!/usr/bin/env node
// Regression guard against the class of bug that broke production once:
// a cron Route Handler at src/app/api/cron/<name>/route.ts existing without
// a matching vercel.json `crons` entry, or vice versa. Either case is
// silently broken in prod — the route handler is never invoked, or the
// scheduler hits a 404 every tick.
//
// This script is dependency-free, runs in `pnpm check:cron`, and is the
// gate in .github/workflows/cron-schedule-check.yml.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(new URL("..", import.meta.url).pathname)
const cronRoutesDir = resolve(repoRoot, "src/app/api/cron")
const vercelConfigPath = resolve(repoRoot, "vercel.json")

function discoverRoutes() {
  if (!existsSync(cronRoutesDir)) return []
  const entries = readdirSync(cronRoutesDir, { withFileTypes: true })
  const routes = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = resolve(cronRoutesDir, entry.name)
    // A cron route is a dir under src/app/api/cron containing a route.ts file.
    const routeFile = resolve(dir, "route.ts")
    if (existsSync(routeFile) && statSync(routeFile).isFile()) {
      routes.push(`/api/cron/${entry.name}`)
    }
  }
  return routes.sort()
}

function discoverScheduledPaths() {
  if (!existsSync(vercelConfigPath)) return []
  const raw = readFileSync(vercelConfigPath, "utf8")
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(`vercel.json is not valid JSON: ${err.message}`)
    process.exit(2)
  }
  const crons = Array.isArray(parsed.crons) ? parsed.crons : []
  const paths = []
  for (const cron of crons) {
    if (typeof cron?.path === "string") paths.push(cron.path)
  }
  return [...new Set(paths)].sort()
}

const routes = discoverRoutes()
const scheduled = discoverScheduledPaths()

const routesSet = new Set(routes)
const scheduledSet = new Set(scheduled)

const routesWithoutSchedule = routes.filter((p) => !scheduledSet.has(p))
const schedulesWithoutRoute = scheduled.filter((p) => !routesSet.has(p))

if (routesWithoutSchedule.length === 0 && schedulesWithoutRoute.length === 0) {
  console.log(
    `cron schedule check: ${routes.length} route(s) ↔ ${scheduled.length} schedule(s) aligned.`,
  )
  process.exit(0)
}

console.error("cron schedule check failed.")
if (routesWithoutSchedule.length > 0) {
  console.error("")
  console.error("Cron routes with no vercel.json entry (will never run):")
  for (const p of routesWithoutSchedule) console.error(`  - ${p}`)
}
if (schedulesWithoutRoute.length > 0) {
  console.error("")
  console.error("vercel.json entries with no matching route (will 404):")
  for (const p of schedulesWithoutRoute) console.error(`  - ${p}`)
}
console.error("")
console.error(
  "Fix: add the missing route under src/app/api/cron/<name>/route.ts, or add the missing entry to vercel.json `crons`.",
)
process.exit(1)
