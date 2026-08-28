// Standard NHL rink perimeter template for the Dasher Board Perimeter Builder.
// Applied atomically by the dasher_boards_apply_template RPC (migration 261);
// the result is a typed sequence the admin edits afterward — never a forced
// layout. Door subtypes and zones are resolved server-side against the
// facility/rink (both seeded by migrations 194/204/257). NO server-only imports
// live here, so this module is safe to unit-test in isolation (see
// perimeter-template.test.ts).

export type TemplateSegmentType = "board_panel" | "door" | "corner_radius" | "post_gap"

export type TemplateSegment = {
  type: TemplateSegmentType
  doorSubtypeLabel: string | null
  zoneName: string | null
}

// Helper: create a run of identical segments for readability.
const run = (
  count: number,
  type: TemplateSegmentType,
  zoneName: string,
  doorSubtypeLabel: string | null = null,
): TemplateSegment[] =>
  Array.from({ length: count }, () => ({
    type,
    doorSubtypeLabel,
    zoneName,
  }))

/**
 * STANDARD_RINK_TEMPLATE — the 50-entry starting template for an NHL 200'×85'
 * rink (footprint), walking clockwise from the north-end boards. Entries are
 * resolved against the facility's seeded door subtypes and zones before
 * persisting; an admin can then edit the sequence.
 */
export const STANDARD_RINK_TEMPLATE = [
  // 1. North End: 2 boards, 1 Zamboni door, 3 boards
  ...run(2, "board_panel", "North End"),
  ...run(1, "door", "North End", "Zamboni"),
  ...run(3, "board_panel", "North End"),

  // 2. NE corner: 3 corner radius
  ...run(3, "corner_radius", "North End"),

  // 3. East Side upper: 4 boards
  ...run(4, "board_panel", "East Side"),

  // 4. Penalty Boxes: 1 board, 1 Penalty door, 1 board, 1 Penalty door, 1 board
  ...run(1, "board_panel", "Penalty Boxes"),
  ...run(1, "door", "Penalty Boxes", "Penalty"),
  ...run(1, "board_panel", "Penalty Boxes"),
  ...run(1, "door", "Penalty Boxes", "Penalty"),
  ...run(1, "board_panel", "Penalty Boxes"),

  // 5. East Side lower: 4 boards
  ...run(4, "board_panel", "East Side"),

  // 6. SE corner: 3 corner radius
  ...run(3, "corner_radius", "South End"),

  // 7. South End: 6 boards
  ...run(6, "board_panel", "South End"),

  // 8. SW corner: 3 corner radius
  ...run(3, "corner_radius", "South End"),

  // 9. West Side lower: 3 boards
  ...run(3, "board_panel", "West Side"),

  // 10. Visitor Bench: 1 board, 1 Bench door, 1 board
  ...run(1, "board_panel", "Visitor Bench"),
  ...run(1, "door", "Visitor Bench", "Bench"),
  ...run(1, "board_panel", "Visitor Bench"),

  // 11. West Side middle: 1 board
  ...run(1, "board_panel", "West Side"),

  // 12. Home Bench: 1 board, 1 Bench door, 1 board
  ...run(1, "board_panel", "Home Bench"),
  ...run(1, "door", "Home Bench", "Bench"),
  ...run(1, "board_panel", "Home Bench"),

  // 13. West Side upper: 3 boards
  ...run(3, "board_panel", "West Side"),

  // 14. NW corner: 3 corner radius
  ...run(3, "corner_radius", "North End"),
] as const

/**
 * Convert a template into the three parallel arrays the RPC expects:
 * types, doorSubtypes (as labels), and zoneNames. Empty string means "none"
 * — the generated client types cannot express a nullable text[] element, so
 * the RPC (migration 261) treats '' and SQL NULL identically.
 */
export function templateToRpcArrays(template: readonly TemplateSegment[]): {
  types: string[]
  doorSubtypes: string[]
  zoneNames: string[]
} {
  return {
    types: template.map((s) => s.type),
    doorSubtypes: template.map((s) => s.doorSubtypeLabel ?? ""),
    zoneNames: template.map((s) => s.zoneName ?? ""),
  }
}
