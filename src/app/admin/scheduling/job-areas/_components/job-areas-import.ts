import { z } from "zod"

import type { ImportSpec } from "@/components/admin/bulk-upload"

// Bulk-import contract for scheduling Job Areas. Imported by both the client
// panel (preview validation) and the server action (re-validation), so the
// rules live in one place. facility_id is derived server-side; sort_order is
// auto-appended. slug defaults from the name when blank. Job areas have no
// color (unlike Daily Report areas); the table is unique on (facility_id, slug).

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const jobAreasImportSpec: ImportSpec = {
  surfaceId: "scheduling-job-areas",
  mode: "strict",
  columns: [
    {
      key: "name",
      header: "Name",
      required: true,
      type: "string",
      example: "Skate Rental",
      description: "Job area name shown in scheduling and on employee profiles.",
    },
    {
      key: "slug",
      header: "Slug",
      required: false,
      type: "string",
      example: "skate-rental",
      description:
        "Optional URL slug (lowercase letters, digits, hyphens). Defaults from the name when blank.",
    },
    {
      key: "is_active",
      header: "Active",
      required: false,
      type: "boolean",
      default: true,
      example: "true",
      description: "Whether the job area is available for new assignments.",
    },
  ],
  zodRow: z.object({
    name: z
      .string({ error: "Name is required" })
      .trim()
      .min(1, "Name is required")
      .max(60, "Name is too long (max 60 characters)"),
    slug: z
      .string()
      .trim()
      .max(64, "Slug is too long (max 64 characters)")
      .refine(
        (s) => s === "" || SLUG_RE.test(s),
        "Slug must be lowercase letters, digits, and hyphens",
      )
      .optional(),
    is_active: z.boolean().default(true),
  }),
}

export type JobAreaImportRow = {
  name: string
  slug?: string
  is_active: boolean
}
