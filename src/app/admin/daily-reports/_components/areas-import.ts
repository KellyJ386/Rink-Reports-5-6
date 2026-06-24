import { z } from "zod"

import type { ImportSpec } from "@/components/admin/bulk-upload"

// Bulk-import contract for Daily Reports areas. Imported by both the client
// panel (preview validation) and the server action (re-validation), so the
// rules live in one place. facility_id is derived server-side; sort_order is
// auto-appended. slug defaults from the name when blank. The 30-active cap is
// enforced by the DB trigger, surfaced as a friendly error on insert.

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const areasImportSpec: ImportSpec = {
  surfaceId: "daily-report-areas",
  mode: "strict",
  columns: [
    {
      key: "name",
      header: "Name",
      required: true,
      type: "string",
      example: "Ice Resurfacer Room",
      description: "Area name shown as a tab to staff on the Daily Reports page.",
    },
    {
      key: "slug",
      header: "Slug",
      required: false,
      type: "string",
      example: "ice-resurfacer-room",
      description:
        "Optional URL slug (lowercase letters, digits, hyphens). Defaults from the name when blank.",
    },
    {
      key: "color",
      header: "Color",
      required: false,
      type: "string",
      example: "#0ea5e9",
      description: "Optional hex color used for the area's chip.",
    },
    {
      key: "is_active",
      header: "Active",
      required: false,
      type: "boolean",
      default: true,
      example: "true",
      description: "Whether the area is visible. Counts toward the 30-active cap.",
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
      .max(64, "Slug is too long (max 64 characters)")
      .refine(
        (s) => s === "" || SLUG_RE.test(s),
        "Slug must be lowercase letters, digits, and hyphens",
      )
      .optional(),
    color: z.string().trim().max(32, "Color is too long").optional(),
    is_active: z.boolean().default(true),
  }),
}

export type AreaImportRow = {
  name: string
  slug?: string
  color?: string
  is_active: boolean
}
