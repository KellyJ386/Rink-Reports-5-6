// Pure resurface planner: given one rink-day's bookings, propose the cut
// bookings that fit in the gaps between consecutive rentals. Dependency-free
// (epoch-ms arithmetic) so vitest runs it in plain Node; the server action
// does all timezone work and re-computes this at APPLY time rather than
// trusting anything a client previewed.
//
// The rules, and why:
//   - Cuts go BETWEEN consecutive bookings only — never before the first or
//     after the last. Opening and closing floods are their own routines and
//     the front desk schedules them deliberately.
//   - A gap is measured from the earlier booking's blocks_until (its own
//     appended buffer included — placing a cut inside that window would be
//     refused by the exclusion constraint anyway) to the next booking's
//     start. The cut is proposed at the START of the gap and must fit
//     entirely.
//   - A gap that already contains (or touches) a resurface booking is
//     skipped: the cut is already planned. Gaps adjacent to a resurface
//     are skipped too — cutting twice around a cut is noise.
//   - Cancelled bookings are the caller's job to exclude before calling.

export type PlannableBooking = {
  startMs: number
  endMs: number
  /** ends + that booking's appended buffer; equals endMs when the facility
   *  bakes the make into the rental. */
  blocksUntilMs: number
  isResurface: boolean
}

export type PlannedCut = {
  startMs: number
  endMs: number
}

export function planCutsForRinkDay(
  bookings: PlannableBooking[],
  cutDurationMs: number,
): PlannedCut[] {
  if (cutDurationMs <= 0 || bookings.length < 2) return []

  const sorted = [...bookings].sort((a, b) => a.startMs - b.startMs)
  const cuts: PlannedCut[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i]
    const next = sorted[i + 1]
    // A cut next to a cut is noise, whichever side it would land on.
    if (prev.isResurface || next.isResurface) continue

    const gapStart = prev.blocksUntilMs
    const gapEnd = next.startMs
    if (gapEnd - gapStart < cutDurationMs) continue

    cuts.push({ startMs: gapStart, endMs: gapStart + cutDurationMs })
  }
  return cuts
}
