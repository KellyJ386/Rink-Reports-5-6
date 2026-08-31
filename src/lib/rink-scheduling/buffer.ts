// Pure resurfacing-buffer resolution. The one place application code turns
// rink_scheduling_settings.default_buffer_minutes,
// facility_rinks.buffer_minutes_override, and
// rink_scheduling_settings.buffer_included_in_rental into the number that
// gets snapshotted onto rink_bookings.buffer_minutes_after at booking
// creation (migration 273) — nothing else should ever type a buffer minute
// count.

export type BufferSource = {
  /** rink_scheduling_settings.default_buffer_minutes. */
  facilityDefaultMinutes: number | null | undefined
  /** facility_rinks.buffer_minutes_override for the chosen sheet. */
  rinkOverrideMinutes: number | null | undefined
  /** rink_scheduling_settings.buffer_included_in_rental. When true, the
   *  make time is sold as part of the booked slot rather than reserved
   *  after it, so nothing is appended — the booked hour already includes
   *  it, and billing was never based on buffer time in the first place. */
  includedInRental: boolean | null | undefined
}

/**
 * The buffer minutes to snapshot for a new booking: 0 when the facility
 * bakes the make time into the rental, else the per-sheet override falling
 * back to the facility default. Both are CHECK-bounded 0-120 in the DB;
 * out-of-range or missing values (a settings row that predates this column)
 * clamp into range rather than producing a negative or day-long buffer.
 */
export function resolveBufferMinutes(source: BufferSource): number {
  if (source.includedInRental) return 0

  const candidate = source.rinkOverrideMinutes ?? source.facilityDefaultMinutes
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return 15
  return Math.min(120, Math.max(0, Math.round(candidate)))
}
