import { z } from "zod"

import type { ImportSpec } from "@/components/admin/bulk-upload"

// Bulk-import contract for Air Quality reading types. Shared by the client
// preview panel and the server action's re-validation. facility_id is derived
// server-side; `key` must be unique per facility (enforced by the DB + action).

const KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/

export const readingTypeImportSpec: ImportSpec = {
  surfaceId: "air-quality-reading-types",
  mode: "strict",
  columns: [
    {
      key: "key",
      header: "Key",
      required: true,
      type: "string",
      example: "co_ppm",
      description:
        "Stable identifier (lowercase letters, digits, underscores). Unique per facility.",
    },
    {
      key: "label",
      header: "Label",
      required: true,
      type: "string",
      example: "Carbon Monoxide",
      description: "Display name shown to staff on the reading input.",
    },
    {
      key: "unit",
      header: "Unit",
      required: true,
      type: "string",
      example: "ppm",
      description: "Unit of measure shown next to the value.",
    },
    {
      key: "decimals",
      header: "Decimals",
      required: false,
      type: "number",
      default: 0,
      example: "1",
      description: "Decimal places (0–6) shown on the reading input.",
    },
    {
      key: "is_required",
      header: "Required",
      required: false,
      type: "boolean",
      default: true,
      example: "true",
      description: "Whether staff must record this reading.",
    },
  ],
  zodRow: z.object({
    key: z
      .string({ error: "Key is required" })
      .trim()
      .min(1, "Key is required")
      .transform((s) => s.toLowerCase())
      .refine(
        (s) => KEY_RE.test(s),
        "Key must be lowercase letters, digits, and underscores",
      ),
    label: z
      .string({ error: "Label is required" })
      .trim()
      .min(1, "Label is required")
      .max(120, "Label is too long (max 120 characters)"),
    unit: z
      .string({ error: "Unit is required" })
      .trim()
      .min(1, "Unit is required")
      .max(50, "Unit is too long (max 50 characters)"),
    decimals: z
      .number({ error: "Decimals must be a number" })
      .int("Decimals must be a whole number")
      .min(0, "Decimals must be between 0 and 6")
      .max(6, "Decimals must be between 0 and 6")
      .default(0),
    is_required: z.boolean().default(true),
  }),
}

export type ReadingTypeImportRow = {
  key: string
  label: string
  unit: string
  decimals: number
  is_required: boolean
}
