#!/usr/bin/env node
// Generates src/types/database.ts from a migrated Postgres database using
// @supabase/postgres-meta (the same engine `supabase gen types` wraps — used
// directly because the CLI requires Docker, which CI service containers and
// some sandboxes don't provide).
//
// Usage:
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//     node scripts/generate-database-types.mjs --write   # regenerate the file
//     node scripts/generate-database-types.mjs --check   # exit 1 if stale (CI)
//
// The database must have ALL repo migrations applied (locally: `supabase
// start`; in CI: the rls-isolation workflow's service container). The
// freshness gate in .github/workflows/rls-isolation.yml runs --check on every
// migration-touching PR, so a migration can't merge without its regenerated
// types — keeping the `as any`-cast era (see git history pre-#128) from
// coming back.

import { readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const TYPES_PATH = join(ROOT, "src/types/database.ts")
const PORT = process.env.PG_META_PORT ?? "18765"

const mode = process.argv[2]
if (mode !== "--write" && mode !== "--check") {
  console.error("Usage: generate-database-types.mjs --write | --check")
  process.exit(2)
}
const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error("DATABASE_URL is required (a migrated local/CI database).")
  process.exit(2)
}

// supabase-js reads this marker for PostgREST version negotiation; pg-meta's
// raw generator output omits it, so we inject it to match the committed file.
const INTERNAL_BLOCK = `export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {`

const serverEntry = join(
  ROOT,
  "node_modules/@supabase/postgres-meta/dist/server/server.js",
)
const server = spawn(process.execPath, [serverEntry], {
  env: { ...process.env, PG_META_PORT: PORT, PG_META_DB_URL: dbUrl },
  stdio: ["ignore", "ignore", "pipe"],
})
let serverErr = ""
server.stderr.on("data", (d) => (serverErr += d))

try {
  const url = `http://127.0.0.1:${PORT}/generators/typescript?included_schemas=public&detect_one_to_one_relationships=true`
  let generated = null
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(url)
      if (res.ok) {
        generated = await res.text()
        break
      }
    } catch {
      // server not up yet — retry
    }
  }
  if (!generated) {
    console.error(`pg-meta did not come up / generate types.\n${serverErr}`)
    process.exit(1)
  }

  const normalized = generated.replace(
    "export type Database = {\n  public: {",
    INTERNAL_BLOCK,
  )

  if (mode === "--write") {
    writeFileSync(TYPES_PATH, normalized)
    console.log(`Wrote ${TYPES_PATH} (${normalized.length} bytes).`)
  } else {
    const committed = readFileSync(TYPES_PATH, "utf8")
    if (committed !== normalized) {
      console.error(
        "src/types/database.ts is STALE relative to supabase/migrations.\n" +
          "Regenerate it against a fully-migrated database:\n" +
          "  DATABASE_URL=... node scripts/generate-database-types.mjs --write",
      )
      process.exit(1)
    }
    console.log("src/types/database.ts is up to date with the schema.")
  }
} finally {
  server.kill()
}
