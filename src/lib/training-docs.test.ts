import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { TOGGLEABLE_MODULE_KEYS } from "./modules/module-keys"
import {
  TRAINING_DOCS,
  TRAINING_GROUPS,
  findTrainingDoc,
  resolveTrainingLink,
  stripLeadingH1,
  trainingDocNeighbors,
  trainingDocsInGroup,
} from "./training-docs"

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(path.relative(ROOT, p).split(path.sep).join("/"))
  }
  return out
}

describe("manifest integrity", () => {
  it("has unique, url-safe slugs and a known group on every entry", () => {
    const slugs = new Set<string>()
    const groups = new Set(TRAINING_GROUPS.map((g) => g.key))
    for (const doc of TRAINING_DOCS) {
      expect(doc.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(slugs.has(doc.slug)).toBe(false)
      slugs.add(doc.slug)
      expect(groups.has(doc.group)).toBe(true)
      expect(doc.audiences.length).toBeGreaterThan(0)
      expect(Boolean(doc.markdown || doc.pdf)).toBe(true)
    }
    // "files" is a static route segment under /admin/training; a doc slug
    // named "files" would be shadowed by it.
    expect(slugs.has("files")).toBe(false)
  })

  it("points every entry at a file that exists in the repo", () => {
    for (const doc of TRAINING_DOCS) {
      for (const rel of [doc.markdown, doc.pdf]) {
        if (!rel) continue
        expect(rel.startsWith("docs/"), `${doc.slug}: ${rel}`).toBe(true)
        expect(existsSync(path.join(ROOT, rel)), `${doc.slug}: ${rel}`).toBe(
          true,
        )
      }
    }
  })

  it("indexes every training file on disk (add new docs to the manifest)", () => {
    const indexed = new Set(
      TRAINING_DOCS.flatMap((d) => [d.markdown, d.pdf].filter(Boolean)),
    )
    const onDisk = [
      ...walk(path.join(ROOT, "docs/training")),
      ...walk(path.join(ROOT, "docs/training-guide")),
    ].filter((p) => p.endsWith(".md") || p.endsWith(".pdf"))
    const missing = onDisk.filter((p) => !indexed.has(p))
    expect(missing).toEqual([])
  })

  it("keeps every group non-empty", () => {
    for (const g of TRAINING_GROUPS) {
      expect(trainingDocsInGroup(g.key).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Every toggleable module needs a training chapter. This is the exact bug
// class that let 5 modules (Dasher Boards, Accident Reports, Rink Scheduling,
// Communications, Facility Paperwork) ship with no chapter for a long time:
// nothing cross-checked TOGGLEABLE_MODULE_KEYS against the manifest. Adding a
// module key without a chapter (or removing a chapter while its key remains)
// now fails here instead of silently shipping a gap.
// ---------------------------------------------------------------------------

// Module keys that intentionally have no dedicated training chapter, and why.
// Keep this list short and documented — every entry here is a module a
// reviewer could reasonably expect a chapter for, so silence is not an option.
const MODULE_KEYS_WITHOUT_A_CHAPTER: ReadonlySet<string> = new Set([
  "reports", // "Insights" — cross-module analytics with no admin console of
  // its own (not in nav-config's "Module Admin" group); not a
  // report/submission module, so it doesn't fit the one-chapter-per-module
  // pattern.
])

// Module keys whose doc slug isn't the mechanical
// `module-${key.replace(/_/g, "-")}` transform, because the chapter is
// titled differently than the module key.
const MODULE_KEY_TO_DOC_SLUG: Readonly<Record<string, string>> = {
  refrigeration: "module-refrigeration-logs",
  incident_reports: "module-incident-reporting",
  scheduling: "module-employee-scheduling",
}

function expectedDocSlug(moduleKey: string): string {
  return (
    MODULE_KEY_TO_DOC_SLUG[moduleKey] ??
    `module-${moduleKey.replace(/_/g, "-")}`
  )
}

describe("every module has a training chapter", () => {
  it("has a modules-group manifest entry for every toggleable module key", () => {
    const moduleSlugs = new Set(
      trainingDocsInGroup("modules").map((d) => d.slug),
    )
    const missing = TOGGLEABLE_MODULE_KEYS.filter(
      (key) =>
        !MODULE_KEYS_WITHOUT_A_CHAPTER.has(key) &&
        !moduleSlugs.has(expectedDocSlug(key)),
    )
    expect(missing).toEqual([])
  })

  it("has no modules-group entry that doesn't map back to a real module key", () => {
    const expectedSlugs = new Set(
      TOGGLEABLE_MODULE_KEYS.filter(
        (k) => !MODULE_KEYS_WITHOUT_A_CHAPTER.has(k),
      ).map(expectedDocSlug),
    )
    // admin-control-center is a real chapter with no toggleable module key
    // (the Admin Center is never toggleable) — allow it explicitly.
    const orphaned = trainingDocsInGroup("modules")
      .map((d) => d.slug)
      .filter(
        (slug) => slug !== "module-admin-control-center" && !expectedSlugs.has(slug),
      )
    expect(orphaned).toEqual([])
  })
})

describe("lookups + navigation", () => {
  it("finds docs by slug and rejects unknown/prototype keys", () => {
    expect(findTrainingDoc("master-manual")?.title).toMatch(/Manual/)
    expect(findTrainingDoc("nope")).toBeNull()
    expect(findTrainingDoc("__proto__")).toBeNull()
    expect(findTrainingDoc("constructor")).toBeNull()
  })

  it("walks prev/next within a group in manifest order, skipping pdf-only entries", () => {
    const first = findTrainingDoc("guide-01-getting-started")!
    const { prev, next } = trainingDocNeighbors(first)
    expect(prev).toBeNull()
    expect(next?.slug).toBe("guide-02-staff-reports")

    const last = findTrainingDoc("guide-07-quick-reference")!
    expect(trainingDocNeighbors(last).next).toBeNull()
    expect(trainingDocNeighbors(last).prev?.slug).toBe(
      "guide-06-admin-modules",
    )
  })
})

describe("stripLeadingH1", () => {
  it("removes only a leading H1", () => {
    expect(stripLeadingH1("# Title\n\nBody")).toBe("\nBody")
    expect(stripLeadingH1("\n\n# Title\nBody")).toBe("Body")
    expect(stripLeadingH1("Intro\n# Not first")).toBe("Intro\n# Not first")
    expect(stripLeadingH1("## H2 first")).toBe("## H2 first")
  })
})

describe("resolveTrainingLink", () => {
  const manual = findTrainingDoc("master-manual")!
  const scheduling = findTrainingDoc("module-employee-scheduling")!
  const guidePdf = findTrainingDoc("training-guide")!

  it("passes anchors, app routes, and absolute URLs through", () => {
    expect(resolveTrainingLink("#glossary", manual)).toBe("#glossary")
    expect(resolveTrainingLink("/admin/permissions", manual)).toBe(
      "/admin/permissions",
    )
    expect(resolveTrainingLink("https://example.com/x", manual)).toBe(
      "https://example.com/x",
    )
    expect(resolveTrainingLink("mailto:a@b.c", manual)).toBe("mailto:a@b.c")
  })

  it("maps relative markdown links to in-app routes, keeping the anchor", () => {
    expect(resolveTrainingLink("./ONBOARDING-ADMIN.md", manual)).toBe(
      "/admin/training/onboarding-admin",
    )
    expect(
      resolveTrainingLink(
        "./modules/employee-scheduling.md#publishing",
        manual,
      ),
    ).toBe("/admin/training/module-employee-scheduling#publishing")
    // From inside modules/, a parent-relative link back to the manual.
    expect(
      resolveTrainingLink(
        "../MASTER-MANUAL.md#how-rinkreports-is-organized",
        scheduling,
      ),
    ).toBe("/admin/training/master-manual#how-rinkreports-is-organized")
  })

  it("maps a link to a PDF onto the file route", () => {
    expect(
      resolveTrainingLink("./pdf/RinkReports-Master-Manual.pdf", manual),
    ).toBe("/admin/training/files/master-manual")
  })

  it("returns null for relative targets outside the manifest", () => {
    expect(resolveTrainingLink("../DEPLOY.md", manual)).toBeNull()
    expect(resolveTrainingLink("../../etc/passwd", manual)).toBeNull()
    expect(resolveTrainingLink("", manual)).toBeNull()
    // A pdf-only doc has no directory to resolve against.
    expect(resolveTrainingLink("./anything.md", guidePdf)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PDF renditions. scripts/training-pdf/builds.json declares which markdown
// files go into each PDF; build.py stamps a SHA-256 of those sources into the
// PDF's Keywords metadata. Recompute it here so a doc edit without a rebuild
// (`pnpm docs:pdf`) fails CI instead of shipping a stale handout.
// ---------------------------------------------------------------------------
type PdfBuild = { path: string; parts: { sources: string[] }[] }

const BUILDS_JSON = path.join(ROOT, "scripts/training-pdf/builds.json")
const builds = (
  JSON.parse(readFileSync(BUILDS_JSON, "utf8")) as { outputs: PdfBuild[] }
).outputs

// Must match source_hash() in scripts/training-pdf/build.py byte for byte.
function sourceHash(sources: string[]): string {
  const h = createHash("sha256")
  for (const rel of sources) {
    const data = readFileSync(path.join(ROOT, rel))
    const normalized = Buffer.from(
      data.toString("latin1").replace(/\r\n/g, "\n"),
      "latin1",
    )
    h.update(Buffer.from(`${rel}\n`, "utf8"))
    h.update(normalized)
    h.update(Buffer.from("\n"))
  }
  return h.digest("hex")
}

describe("pdf renditions (scripts/training-pdf/builds.json)", () => {
  it("builds exactly the PDFs the manifest lists", () => {
    const manifestPdfs = TRAINING_DOCS.flatMap((d) => (d.pdf ? [d.pdf] : []))
    const built = builds.map((b) => b.path)
    expect([...built].sort()).toEqual([...manifestPdfs].sort())
  })

  it("builds every PDF only from markdown the manifest indexes", () => {
    const indexed = new Set(TRAINING_DOCS.map((d) => d.markdown))
    for (const b of builds) {
      for (const src of b.parts.flatMap((p) => p.sources)) {
        expect(indexed.has(src), `${b.path}: ${src}`).toBe(true)
      }
    }
  })

  it("has every PDF built from the current markdown (run pnpm docs:pdf)", () => {
    const stale: string[] = []
    for (const b of builds) {
      const pdf = readFileSync(path.join(ROOT, b.path))
      const m = /rinkreports-source-sha256:([0-9a-f]{64})/.exec(
        pdf.toString("latin1"),
      )
      const want = sourceHash(b.parts.flatMap((p) => p.sources))
      if (m?.[1] !== want) stale.push(b.path)
    }
    expect(stale).toEqual([])
  })
})
