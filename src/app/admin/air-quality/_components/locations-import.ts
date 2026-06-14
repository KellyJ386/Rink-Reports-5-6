import { z } from "zod"

import type { ImportSpec } from "@/components/admin/bulk-upload"

// Bulk-import contract for Air Quality locations. Shared by the client preview
// panel and the server action's re-validation. facility_id is derived
// server-side; `slug` is optional and auto-derived from `name` (and made unique)
// by the server action, mirroring the single-location create flow.

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const locationImportSpec: ImportSpec = {
  surfaceId: "air-quality-locations",
  mode: "strict",
  columns: [
    {
      key: "name",
      header: "Name",
      required: true,
      type: "string",
      example: "Main Rink",
      description: "Display name shown to staff when choosing a location.",
    },
    {
      key: "slug",
      header: "Slug",
      required: false,
      type: "string",
      example: "main-rink",
      description:
        "Auto-generated from name if blank. Lowercase letters, digits, hyphens; unique per facility.",
    },
    {
      key: "sort_order",
      header: "Sort",
      required: false,
      type: "number",
      default: 0,
      example: "1",
      description: "Display order (lower sorts first). Defaults to appended.",
    },
    {
      key: "is_active",
      header: "Active",
      required: false,
      type: "boolean",
      default: true,
      example: "true",
      description: "Whether staff can select this location on new reports.",
    },
  ],
  zodRow: z.object({
    name: z
      .string({ error: "Name is required" })
      .trim()
      .min(1, "Name is required")
      .max(120, "Name is too long (max 120 characters)"),
    slug: z
      .string()
      .trim()
      .transform((s) => s.toLowerCase())
      .refine(
        (s) => s === "" || SLUG_RE.test(s),
        "Slug must be lowercase letters, digits, and hyphens",
      )
      .optional(),
    sort_order: z
      .number({ error: "Sort must be a number" })
      .int("Sort must be a whole number")
      .default(0),
    is_active: z.boolean().default(true),
  }),
}

export type LocationImportRow = {
  name: string
  slug?: string
  sort_order: number
  is_active: boolean
}
