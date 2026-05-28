import { z } from "zod"

import type { ImportSpec } from "@/components/admin/bulk-upload"

import { EQUIPMENT_TYPES } from "../types"

// Bulk-import contracts for the two flat circle-check builder surfaces. Shared
// by the client preview and the server re-validation. facility_id is always
// derived server-side; template_id (for template fields) is contextual.

const equipmentKeys = EQUIPMENT_TYPES.map((e) => e.key) as [string, ...string[]]

// --- Facility circle-check items -------------------------------------------

export const circleCheckItemsImportSpec: ImportSpec = {
  surfaceId: "circle-check-items",
  mode: "strict",
  columns: [
    {
      key: "label",
      header: "Label",
      required: true,
      type: "string",
      example: "Check blade condition",
      description: "Item text shown to staff during a circle check.",
    },
    {
      key: "description",
      header: "Description",
      required: false,
      type: "string",
      example: "Look for nicks and chips",
      description: "Optional helper text shown under the item.",
    },
    {
      key: "applies_to_equipment_type",
      header: "Applies To Equipment Type",
      required: false,
      type: "enum",
      enumValues: [...equipmentKeys],
      example: "ice_resurfacer",
      description: "Limit the item to one equipment type. Blank = all types.",
    },
    {
      key: "response_type",
      header: "Response Type",
      required: false,
      type: "enum",
      enumValues: ["pass_fail", "text"],
      default: "pass_fail",
      example: "pass_fail",
      description: "How staff answer: pass_fail (default) or text.",
    },
    {
      key: "is_response_required",
      header: "Is Response Required",
      required: false,
      type: "boolean",
      default: false,
      example: "false",
      description:
        "Only meaningful for text items: whether the answer is mandatory. Ignored for pass_fail.",
    },
  ],
  zodRow: z
    .object({
      label: z
        .string({ error: "Label is required" })
        .trim()
        .min(1, "Label is required")
        .max(200, "Label is too long (max 200 characters)"),
      description: z
        .string()
        .trim()
        .max(1000, "Description is too long (max 1000 characters)")
        .optional(),
      applies_to_equipment_type: z
        .enum(equipmentKeys, {
          error: `Must be one of: ${equipmentKeys.join(", ")}`,
        })
        .optional(),
      response_type: z.enum(["pass_fail", "text"]).default("pass_fail"),
      is_response_required: z.boolean().default(false),
    })
    // is_response_required only applies to text items; force false otherwise.
    .transform((v) => ({
      ...v,
      is_response_required:
        v.response_type === "text" ? v.is_response_required : false,
    })),
}

// --- Circle-check template fields ------------------------------------------

export const circleCheckTemplateItemsImportSpec: ImportSpec = {
  surfaceId: "circle-check-template-fields",
  mode: "strict",
  columns: [
    {
      key: "label",
      header: "Label",
      required: true,
      type: "string",
      example: "Verify fuel level",
      description: "Field label shown to staff for this template.",
    },
    {
      key: "description",
      header: "Description",
      required: false,
      type: "string",
      example: "Top off if below half",
      description: "Optional helper text shown under the field.",
    },
  ],
  zodRow: z.object({
    label: z
      .string({ error: "Label is required" })
      .trim()
      .min(1, "Label is required")
      .max(200, "Label is too long (max 200 characters)"),
    description: z
      .string()
      .trim()
      .max(1000, "Description is too long (max 1000 characters)")
      .optional(),
  }),
}
