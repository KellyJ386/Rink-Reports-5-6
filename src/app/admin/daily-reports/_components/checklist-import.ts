import { z } from "zod"

import type { ImportSpec } from "@/components/admin/bulk-upload"

// Bulk-import contract for Daily Reports checklist items. Imported by both the
// client panel (preview validation) and the server action (re-validation), so
// the rules live in one place. template_id is contextual (the selected
// template) and facility_id is derived server-side — neither is a column.

export const checklistImportSpec: ImportSpec = {
  surfaceId: "daily-report-checklist-items",
  mode: "strict",
  columns: [
    {
      key: "label",
      header: "Label",
      required: true,
      type: "string",
      example: "Inspect ice surface for cracks",
      description: "Checklist item text shown to staff as a checkbox row.",
    },
    {
      key: "description",
      header: "Description",
      required: false,
      type: "string",
      example: "Note any chips along the boards",
      description: "Optional helper text shown under the item.",
    },
  ],
  zodRow: z.object({
    label: z
      .string({ error: "Label is required" })
      .trim()
      .min(1, "Label is required")
      .max(500, "Label is too long (max 500 characters)"),
    description: z
      .string()
      .trim()
      .max(1000, "Description is too long (max 1000 characters)")
      .optional(),
  }),
}
