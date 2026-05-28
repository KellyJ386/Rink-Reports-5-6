import { z } from "zod"

import type { ImportSpec } from "@/components/admin/bulk-upload"

import { DROPDOWN_CATEGORIES, type DropdownCategory } from "../types"

// Bulk-import contract for Accident Report dropdown values. Shared by the
// client preview panel and the server action's re-validation. facility_id is
// derived server-side; (category, key) is unique per facility.

const KEY_RE = /^[a-z0-9_]+$/
const categoryKeys = [...DROPDOWN_CATEGORIES] as [string, ...string[]]

export const dropdownsImportSpec: ImportSpec = {
  surfaceId: "accident-dropdowns",
  mode: "strict",
  columns: [
    {
      key: "category",
      header: "Category",
      required: true,
      type: "enum",
      enumValues: [...categoryKeys],
      example: "body_part",
      description: `One of: ${categoryKeys.join(", ")}.`,
    },
    {
      key: "key",
      header: "Key",
      required: true,
      type: "string",
      example: "wrists",
      description:
        "Stable identifier (lowercase letters, digits, underscores). Unique within a category.",
    },
    {
      key: "display_name",
      header: "Display Name",
      required: true,
      type: "string",
      example: "Wrists",
      description: "Label shown to staff in the dropdown.",
    },
    {
      key: "color",
      header: "Color",
      required: false,
      type: "string",
      example: "#16a34a",
      description: "Optional hex color; used by the severity category.",
    },
    {
      key: "is_active",
      header: "Active",
      required: false,
      type: "boolean",
      default: true,
      example: "true",
      description: "Whether the value is selectable.",
    },
    {
      key: "triggers_alert",
      header: "Triggers Alert",
      required: false,
      type: "boolean",
      default: false,
      example: "false",
      description:
        "Only meaningful for medical_attention rows; ignored for other categories.",
    },
  ],
  zodRow: z
    .object({
      category: z.enum(categoryKeys, {
        error: `Category must be one of: ${categoryKeys.join(", ")}`,
      }),
      key: z
        .string({ error: "Key is required" })
        .trim()
        .min(1, "Key is required")
        .transform((s) => s.toLowerCase())
        .refine(
          (s) => KEY_RE.test(s),
          "Key must be lowercase letters, digits, and underscores",
        ),
      display_name: z
        .string({ error: "Display name is required" })
        .trim()
        .min(1, "Display name is required")
        .max(120, "Display name is too long (max 120 characters)"),
      color: z
        .string()
        .trim()
        .max(32, "Color is too long")
        .optional(),
      is_active: z.boolean().default(true),
      triggers_alert: z.boolean().default(false),
    })
    // triggers_alert only applies to medical_attention; force false otherwise.
    .transform((v) => ({
      ...v,
      triggers_alert:
        v.category === "medical_attention" ? v.triggers_alert : false,
    })),
}

export type AccidentDropdownImportRow = {
  category: DropdownCategory
  key: string
  display_name: string
  color?: string
  is_active: boolean
  triggers_alert: boolean
}
