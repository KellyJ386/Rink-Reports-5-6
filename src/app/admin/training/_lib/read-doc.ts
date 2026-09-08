import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { cache } from "react"

import type { TrainingDoc } from "@/lib/training-docs"

// The training docs are read straight from the repo's `docs/` folder at
// request time, so the in-app copy can never drift from the committed
// markdown. `next.config.ts` (outputFileTracingIncludes) bundles those files
// into the /admin/training server functions on Vercel; locally they're just
// on disk. Paths come from the manifest only — never from the request.
//
// The `"docs"` literal in path.join is load-bearing: it lets Turbopack's file
// tracer scope the dynamic read to docs/** instead of flagging the whole
// project as traced.
const DOCS_PREFIX = "docs/"

function repoPath(rel: string): string {
  if (!rel.startsWith(DOCS_PREFIX)) {
    throw new Error(`training doc path must live under docs/: ${rel}`)
  }
  return path.join(process.cwd(), "docs", rel.slice(DOCS_PREFIX.length))
}

export const readTrainingMarkdown = cache(
  async (doc: TrainingDoc): Promise<string | null> => {
    if (!doc.markdown) return null
    try {
      return await readFile(repoPath(doc.markdown), "utf8")
    } catch {
      return null
    }
  },
)

export async function readTrainingFile(
  doc: TrainingDoc,
): Promise<{ body: Buffer; fileName: string; contentType: string } | null> {
  const rel = doc.pdf ?? doc.markdown
  if (!rel) return null
  try {
    const body = await readFile(repoPath(rel))
    return {
      body,
      fileName: path.basename(rel),
      contentType: doc.pdf ? "application/pdf" : "text/markdown; charset=utf-8",
    }
  } catch {
    return null
  }
}
