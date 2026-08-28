// Pure validation + pattern logic for the custom segment-label display layer
// (migration 257); mirrors the DB constraints exactly; unit-tested in
// segment-labels.test.ts.

import { z } from "zod"

export const CUSTOM_LABEL_MAX = 40

export const customLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(CUSTOM_LABEL_MAX)

export const ALIAS_MAX = 60
export const MAX_ALIASES = 12

export const aliasesSchema = z
  .string()
  .array()
  .transform((arr) => arr.map((s) => s.trim()).filter((s) => s.length > 0))
  .refine((arr) => arr.length <= MAX_ALIASES)
  .transform((arr) => {
    // Dedupe case-insensitively, preserving first occurrence order.
    const seen = new Set<string>()
    return arr.filter((alias) => {
      const lower = alias.toLowerCase()
      if (seen.has(lower)) return false
      seen.add(lower)
      return true
    })
  })
  .refine((arr) => arr.every((s) => s.length >= 1 && s.length <= ALIAS_MAX))

export const zoneNameSchema = z.string().trim().min(1).max(60)

export type BulkLabelDirection = "with_sequence" | "against_sequence"

export const bulkLabelPatternSchema = z.object({
  prefix: z.string().trim().max(12),
  start: z.number().int().min(0).max(9999),
  step: z.number().int().min(1).max(10),
  direction: z.enum(["with_sequence", "against_sequence"]),
})

export type BulkLabelPattern = z.infer<typeof bulkLabelPatternSchema>

export type BulkLabelPreviewEntry = {
  assetId: string
  customLabel: string
}

/**
 * Generate a preview of bulk labels for a list of asset IDs in perimeter order.
 * Walks the IDs in the given direction, assigning `${prefix}${start + i * step}`.
 */
export function buildBulkLabelPreview(
  assetIdsInPerimeterOrder: readonly string[],
  pattern: BulkLabelPattern,
): BulkLabelPreviewEntry[] {
  const { prefix, start, step, direction } = pattern
  const ids =
    direction === "against_sequence"
      ? [...assetIdsInPerimeterOrder].reverse()
      : [...assetIdsInPerimeterOrder]

  return ids.map((assetId, i) => ({
    assetId,
    customLabel: `${prefix}${start + i * step}`,
  }))
}

/**
 * Find labels in a batch that either collide case-insensitively within themselves
 * or are already present in `existingLabelsLower` (the lowercased set of the rink's
 * OTHER assets' custom labels). Mirrors the DB's case-insensitive per-rink unique
 * index; used for the pre-commit preview.
 *
 * Returns the original-cased labels (deduped) that conflict.
 */
export function findDuplicateLabels(
  entries: readonly BulkLabelPreviewEntry[],
  existingLabelsLower: ReadonlySet<string>,
): string[] {
  const seen = new Map<string, string>() // lower → original casing
  const duplicates = new Set<string>()

  for (const entry of entries) {
    const lower = entry.customLabel.toLowerCase()
    if (seen.has(lower)) {
      // Case-insensitive collision within the batch.
      duplicates.add(seen.get(lower)!)
      duplicates.add(entry.customLabel)
    } else if (existingLabelsLower.has(lower)) {
      // Collision with an existing label.
      duplicates.add(entry.customLabel)
    } else {
      seen.set(lower, entry.customLabel)
    }
  }

  return Array.from(duplicates)
}
