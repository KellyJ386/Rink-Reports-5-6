import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

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
