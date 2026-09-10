// Manifest of the Rink Reports training documentation that ships in the repo
// under `docs/`, plus the pure helpers the admin Training & Documentation
// pages use to index, render, and cross-link it.
//
// Framework agnostic — imported by server components, a route handler, and a
// vitest suite. Keep it free of "server-only" / "use client" imports and of
// filesystem access (reading the files lives in
// src/app/admin/training/_lib/read-doc.ts).
//
// Adding a doc: drop the markdown under docs/, add an entry here, and (for a
// PDF rendition) an output in scripts/training-pdf/builds.json, then run
// `pnpm docs:pdf`. `training-docs.test.ts` fails if a manifest path is
// missing on disk, if a training file on disk is not in the manifest, or if
// a PDF was built from markdown that has since changed — so neither the
// in-app index nor the PDFs can silently drift from the docs folder. Files served to the browser
// are looked up by slug from this list only — never from user input — which
// is what makes the file route safe.

export const TRAINING_INDEX_PATH = "/admin/training"

export type TrainingAudience =
  | "staff"
  | "supervisor"
  | "admin"
  | "super_admin"
  | "authors"

export const TRAINING_AUDIENCE_LABELS: Record<TrainingAudience, string> = {
  staff: "Staff",
  supervisor: "Supervisor",
  admin: "Admin",
  super_admin: "Super admin",
  authors: "Doc authors",
}

export type TrainingGroupKey =
  | "onboarding"
  | "modules"
  | "guide"
  | "setup"
  | "authors"

export type TrainingGroup = {
  key: TrainingGroupKey
  title: string
  description: string
}

export const TRAINING_GROUPS: readonly TrainingGroup[] = [
  {
    key: "onboarding",
    title: "Start here — onboarding guides",
    description:
      "Role-based first-day paths and the complete operations manual. Hand the staff guide to every new hire; admins and supervisors get their own.",
  },
  {
    key: "modules",
    title: "Module chapters",
    description:
      "One chapter per report module: what it is for, how staff use it, how admins configure it, and what works offline.",
  },
  {
    key: "guide",
    title: "Complete training guide",
    description:
      "The single-PDF training guide and its seven chapters, covering staff reports, scheduling on both sides, and the full admin console.",
  },
  {
    key: "setup",
    title: "Install, setup, and deployment",
    description:
      "Getting the app onto a phone, standing up a facility for the first time, and running your own copy of Rink Reports.",
  },
  {
    key: "authors",
    title: "For documentation authors",
    description:
      "Working notes behind the training package. Not for end users; kept here so the whole set lives in one place.",
  },
] as const

export type TrainingDoc = {
  /** URL segment after /admin/training/. Lowercase kebab-case, unique. */
  slug: string
  title: string
  /** One sentence shown on the index page. */
  description: string
  group: TrainingGroupKey
  audiences: readonly TrainingAudience[]
  /** Repo-relative path to the markdown source, if any. */
  markdown?: string
  /** Repo-relative path to a PDF rendition, if any. */
  pdf?: string
}

const T = "docs/training"
const G = "docs/training-guide"

export const TRAINING_DOCS: readonly TrainingDoc[] = [
  // --- Start here -----------------------------------------------------------
  {
    slug: "complete-documentation",
    title: "Complete Documentation (everything, one PDF)",
    description:
      "All three onboarding guides, the Operations & Training Manual with every module chapter, the training guide, and the setup guides, in one printable file.",
    group: "onboarding",
    audiences: ["staff", "supervisor", "admin", "super_admin"],
    pdf: `${T}/pdf/RinkReports-Complete-Documentation.pdf`,
  },
  {
    slug: "onboarding-staff",
    title: "Staff Onboarding — Here's How to Do Your Job",
    description:
      "The short version for staff: sign in, find the modules you have access to, and submit the reports your shift is responsible for.",
    group: "onboarding",
    audiences: ["staff"],
    markdown: `${T}/ONBOARDING-STAFF.md`,
    pdf: `${T}/pdf/RinkReports-Onboarding-Staff.pdf`,
  },
  {
    slug: "onboarding-supervisor",
    title: "Supervisor Onboarding — Day-to-Day Oversight",
    description:
      "For managers: keep the schedule moving, decide the requests that land in your queue, and review what staff submitted.",
    group: "onboarding",
    audiences: ["supervisor"],
    markdown: `${T}/ONBOARDING-SUPERVISOR.md`,
    pdf: `${T}/pdf/RinkReports-Onboarding-Supervisor.pdf`,
  },
  {
    slug: "onboarding-admin",
    title: "Admin Onboarding — Stand Up a New Facility",
    description:
      "The guided first-day path for getting a brand-new rink live, from facility settings through the first staff invites.",
    group: "onboarding",
    audiences: ["admin", "super_admin"],
    markdown: `${T}/ONBOARDING-ADMIN.md`,
    pdf: `${T}/pdf/RinkReports-Onboarding-Admin.pdf`,
  },
  {
    slug: "master-manual",
    title: "Operations & Training Manual",
    description:
      "The complete manual: how Rink Reports is organized, links to every module chapter, module summaries, and a glossary of cross-module terms.",
    group: "onboarding",
    audiences: ["staff", "supervisor", "admin", "super_admin"],
    markdown: `${T}/MASTER-MANUAL.md`,
    pdf: `${T}/pdf/RinkReports-Master-Manual.pdf`,
  },

  // --- Module chapters (order mirrors the Master Manual's table of contents) -
  {
    slug: "module-admin-control-center",
    title: "Admin Control Center",
    description:
      "The facility's back office: modules, people, roles and permissions, shared lists, exports, data retention, and the audit trail.",
    group: "modules",
    audiences: ["admin", "super_admin"],
    markdown: `${T}/modules/admin-control-center.md`,
  },
  {
    slug: "module-daily-reports",
    title: "Daily Reports",
    description:
      "Shift checklists per work area: how staff submit them, how admins build templates, and how submissions are reviewed and corrected.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/daily-reports.md`,
  },
  {
    slug: "module-refrigeration-logs",
    title: "Refrigeration Logs",
    description:
      "Logging a refrigeration round, the °F/°C toggle and normal-range hints, and the admin setup and history tabs.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/refrigeration-logs.md`,
  },
  {
    slug: "module-incident-reporting",
    title: "Incident Reporting",
    description:
      "Filing an incident, the admin follow-up workflow, and how locking, saving, and offline submission behave.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/incident-reporting.md`,
  },
  {
    slug: "module-accident-reports",
    title: "Accident Reports",
    description:
      "Reporting a personal injury: who was hurt, body parts and severity, workers'-comp acknowledgement, and the admin dropdowns and alert triggers.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/accident-reports.md`,
  },
  {
    slug: "module-ice-operations",
    title: "Ice Operations",
    description:
      "The resurfacing and ice-maintenance logbook: operation types, staff entries stamped with who and when, and the admin tabs.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/ice-operations.md`,
  },
  {
    slug: "module-air-quality",
    title: "Air Quality",
    description:
      "Logging air-quality readings against warn and alert ranges, and configuring reading types and thresholds as an admin.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/air-quality.md`,
  },
  {
    slug: "module-ice-depth",
    title: "Ice Depth",
    description:
      "Point-by-point ice thickness on the rink diagram, using a Bluetooth caliper, and setting targets as an admin.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/ice-depth.md`,
  },
  {
    slug: "module-dasher-boards",
    title: "Dasher Boards",
    description:
      "The rink-perimeter condition map: reporting board, glass, and door issues, inspection walks, and the admin perimeter/checklist setup.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/dasher-boards.md`,
  },
  {
    slug: "module-facility-paperwork",
    title: "Facility Paperwork",
    description:
      "The read-only staff document library and the admin bulk-upload console behind it.",
    group: "modules",
    audiences: ["staff", "admin"],
    markdown: `${T}/modules/facility-paperwork.md`,
  },
  {
    slug: "module-communications",
    title: "Communications",
    description:
      "Facility alerts and staff messaging, and the admin routing rules that fan submissions out to the right people.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/communications.md`,
  },
  {
    slug: "module-employee-scheduling",
    title: "Employee Scheduling",
    description:
      "Draft vs. published schedules, the admin grid, publishing, certification gates, time-off and swaps, and what queues offline.",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/employee-scheduling.md`,
  },
  {
    slug: "module-rink-scheduling",
    title: "Rink Scheduling",
    description:
      "Ice-time booking and billing: the admin booking calendar, rate cards, season contracts, invoices, and the front-desk view. Not to be confused with Employee Scheduling (staff shifts).",
    group: "modules",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${T}/modules/rink-scheduling.md`,
  },

  // --- Complete training guide ----------------------------------------------
  {
    slug: "training-guide",
    title: "Rink Reports Training Guide (complete PDF)",
    description:
      "Every staff report module, scheduling for staff and admins, and the full admin console in one printable guide.",
    group: "guide",
    audiences: ["staff", "supervisor", "admin", "super_admin"],
    pdf: `${G}/rink-reports-training-guide.pdf`,
  },
  {
    slug: "guide-01-getting-started",
    title: "1. Welcome & Getting Started",
    description:
      "Sign-in, navigation, the dashboard, your account, and a primer on how permissions decide what you see.",
    group: "guide",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${G}/src/ch01-getting-started.md`,
  },
  {
    slug: "guide-02-staff-reports",
    title: "2. Staff Report Modules",
    description:
      "Daily, incidents, accidents, ice depth, ice operations, refrigeration, air quality, dasher boards, facility paperwork, communications, and offline work.",
    group: "guide",
    audiences: ["staff", "supervisor"],
    markdown: `${G}/src/ch02-staff-reports.md`,
  },
  {
    slug: "guide-03-scheduling-staff",
    title: "3. Scheduling — For Staff",
    description:
      "My schedule, open shifts, drops, availability, time off, swaps, and calendar sync.",
    group: "guide",
    audiences: ["staff", "supervisor"],
    markdown: `${G}/src/ch03-scheduling-staff.md`,
  },
  {
    slug: "guide-04-scheduling-admin",
    title: "4. Scheduling — For Admins",
    description:
      "The rules engine, the grid, templates, two-person publish, the request queues, and settings.",
    group: "guide",
    audiences: ["supervisor", "admin"],
    markdown: `${G}/src/ch04-scheduling-admin.md`,
  },
  {
    slug: "guide-05-admin-core",
    title: "5. Admin Console — Setup & System",
    description:
      "Employees, permissions, roles, facility, exports, retention, the audit log, and the super admin console.",
    group: "guide",
    audiences: ["admin", "super_admin"],
    markdown: `${G}/src/ch05-admin-core.md`,
  },
  {
    slug: "guide-06-admin-modules",
    title: "6. Admin Console — Module Administration",
    description:
      "Each module's admin console and the alert and routing pipeline behind them.",
    group: "guide",
    audiences: ["admin", "super_admin"],
    markdown: `${G}/src/ch06-admin-modules.md`,
  },
  {
    slug: "guide-07-quick-reference",
    title: "7. Quick Reference",
    description:
      "Status lifecycles, the approval matrix, the offline matrix, and training checklists at a glance.",
    group: "guide",
    audiences: ["staff", "supervisor", "admin"],
    markdown: `${G}/src/ch07-quickref.md`,
  },

  // --- Install, setup, deployment -------------------------------------------
  {
    slug: "install-on-your-phone",
    title: "Install Rink Reports on Your Phone",
    description:
      "Add the app to a phone's home screen so it opens like a regular app, stays signed in, and keeps working rink-side offline.",
    group: "setup",
    audiences: ["staff", "supervisor", "admin"],
    markdown: "docs/pwa-install-guide.md",
    pdf: `${T}/pdf/RinkReports-Install-On-Your-Phone.pdf`,
  },
  {
    slug: "admin-setup-guide",
    title: "Admin Setup Guide",
    description:
      "Practical first-time setup for a facility manager holding Super Admin credentials, step by step.",
    group: "setup",
    audiences: ["admin", "super_admin"],
    markdown: "docs/admin-setup-guide.md",
    pdf: `${T}/pdf/RinkReports-Admin-Setup-Guide.pdf`,
  },
  {
    slug: "duplicate-setup",
    title: "Duplicating Rink Reports — Setup Guide",
    description:
      "Stand up a complete, independent copy of the app with its own Supabase backend, login, and deployment.",
    group: "setup",
    audiences: ["super_admin"],
    markdown: `${T}/DUPLICATE-SETUP.md`,
    pdf: `${T}/pdf/RinkReports-Duplicate-Setup.pdf`,
  },

  // --- For documentation authors --------------------------------------------
  {
    slug: "training-discovery-manifest",
    title: "Training Discovery Manifest",
    description:
      "The read-only map of the app the training chapters were written against; ⚠ VERIFY flags mark claims not confirmed in code.",
    group: "authors",
    audiences: ["authors"],
    markdown: `${T}/00-MANIFEST.md`,
  },
  {
    slug: "training-guide-readme",
    title: "Training Guide — Contents & PDF Build",
    description:
      "What the complete training guide covers and how to rebuild its PDF from the chapter markdown.",
    group: "authors",
    audiences: ["authors"],
    markdown: `${G}/README.md`,
  },
] as const

const BY_SLUG: ReadonlyMap<string, TrainingDoc> = new Map(
  TRAINING_DOCS.map((d) => [d.slug, d]),
)

const BY_PATH: ReadonlyMap<string, TrainingDoc> = new Map(
  TRAINING_DOCS.flatMap((d) => {
    const pairs: [string, TrainingDoc][] = []
    if (d.markdown) pairs.push([d.markdown, d])
    if (d.pdf) pairs.push([d.pdf, d])
    return pairs
  }),
)

export function findTrainingDoc(slug: string): TrainingDoc | null {
  return BY_SLUG.get(slug) ?? null
}

export function trainingDocsInGroup(group: TrainingGroupKey): TrainingDoc[] {
  return TRAINING_DOCS.filter((d) => d.group === group)
}

/** In-app route that renders a doc's markdown. Null when it has no markdown. */
export function trainingDocHref(doc: TrainingDoc): string | null {
  return doc.markdown ? `${TRAINING_INDEX_PATH}/${doc.slug}` : null
}

/** Route that streams a doc's PDF (falls back to the raw markdown). */
export function trainingFileHref(doc: TrainingDoc): string {
  return `${TRAINING_INDEX_PATH}/files/${doc.slug}`
}

/** Previous / next doc within the same group, in manifest order. */
export function trainingDocNeighbors(doc: TrainingDoc): {
  prev: TrainingDoc | null
  next: TrainingDoc | null
} {
  const siblings = trainingDocsInGroup(doc.group).filter((d) => d.markdown)
  const i = siblings.findIndex((d) => d.slug === doc.slug)
  return {
    prev: i > 0 ? siblings[i - 1] : null,
    next: i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : null,
  }
}

/**
 * Drop a leading `# Title` line so the page header (which already shows the
 * manifest title) isn't followed by a second H1.
 */
export function stripLeadingH1(markdown: string): string {
  const lines = markdown.split("\n")
  let i = 0
  while (i < lines.length && lines[i].trim() === "") i += 1
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    return lines.slice(i + 1).join("\n")
  }
  return markdown
}

/** POSIX-style normalize for repo-relative paths (no filesystem access). */
function normalizeRepoPath(from: string, href: string): string {
  const dir = from.split("/").slice(0, -1)
  const out = [...dir]
  for (const seg of href.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join("/")
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Rewrite a link found inside a training markdown file so it works in-app.
 *
 * - in-page anchors, absolute URLs, `mailto:`, and app routes (`/admin/...`)
 *   pass through unchanged;
 * - a relative link to another manifest doc becomes its in-app route (PDF
 *   targets become the file route), keeping any `#anchor`;
 * - a relative link to anything NOT in the manifest returns null, and the
 *   renderer shows it as plain text rather than a broken link.
 */
export function resolveTrainingLink(
  href: string,
  from: TrainingDoc,
): string | null {
  if (!href) return null
  if (href.startsWith("#") || href.startsWith("/") || HAS_SCHEME.test(href)) {
    return href
  }
  if (!from.markdown) return null

  const hashIndex = href.indexOf("#")
  const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : ""

  const target = normalizeRepoPath(from.markdown, pathPart)
  const doc = BY_PATH.get(target)
  if (!doc) return null

  if (doc.markdown === target) {
    return `${trainingDocHref(doc)}${hash}`
  }
  return trainingFileHref(doc)
}
