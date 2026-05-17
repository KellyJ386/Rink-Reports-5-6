"use client"

import dynamic from "next/dynamic"

import type { BodyDiagramProps } from "./body-diagram"

/**
 * Lazy-loaded BodyDiagram. The component is 567 lines of inline SVG —
 * heavy enough to be worth keeping out of the staff/accidents submission
 * form's first-load JS bundle on slow rink WiFi. By the time a user has
 * filled the top of the form (name, contact, datetime) the chunk has
 * downloaded in parallel, so the body-parts section is ready before they
 * scroll to it.
 *
 * Three call sites benefit from this same indirection:
 *   - /reports/accidents (staff submission)
 *   - /reports/accidents/[id] (staff edit)
 *   - /admin/accident-reports/_components/report-detail (admin review)
 *
 * Sized loading skeleton mirrors the diagram's intrinsic aspect ratio
 * (roughly 1:1.4 portrait of a body silhouette) so there's no layout
 * shift when the chunk swaps in.
 */
export const BodyDiagram = dynamic<BodyDiagramProps>(
  () =>
    import("./body-diagram").then((m) => ({
      default: m.BodyDiagram,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="w-full max-w-md mx-auto aspect-[5/7] rounded-md border border-dashed border-border bg-card/50"
      />
    ),
  },
)
