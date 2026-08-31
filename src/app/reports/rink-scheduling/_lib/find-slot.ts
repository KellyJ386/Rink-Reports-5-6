// Pure open-slot search for one rink-day. Dependency-free (plain epoch
// millisecond arithmetic), so vitest runs it in plain Node; every timezone
// conversion happens in the caller (find-slot-actions.ts) through the same
// helpers the calendar itself uses.
//
// The model mirrors the overlap exclusion constraint exactly: an existing
// booking blocks [starts_at, blocks_until) — its own resurfacing buffer
// included — and a CANDIDATE booking of the requested duration would block
// [start, start + duration + newBuffer). A slot is open only when those two
// half-open intervals never intersect for any existing booking, so anything
// this search offers is something createBooking would actually accept
// (barring a concurrent write, which the constraint still referees).

export type BlockedInterval = {
  /** Epoch ms of starts_at. */
  startMs: number
  /** Epoch ms of blocks_until (ends_at + that booking's buffer). */
  endMs: number
}

export type FindSlotsDayInput = {
  /** Epoch ms the facility opens on this day. */
  openMs: number
  /** Epoch ms the facility closes; already normalized past midnight when the
   *  window wraps (a 6:00–2:00 rink has closeMs on the next calendar day). */
  closeMs: number
  /** Existing bookings' blocked intervals for THIS rink, any order. */
  blocked: BlockedInterval[]
  /** Requested ice time, ms. */
  durationMs: number
  /** The buffer a NEW booking on this rink would carry, ms (0 when the
   *  facility bakes the make into the rental). */
  newBufferMs: number
  /** Candidate step, ms (the facility's slot increment). */
  stepMs: number
  /** Candidates before this instant are skipped — "now" when searching today,
   *  else the day's open. */
  notBeforeMs: number
  /** Stop after this many results for the day. */
  limit: number
}

/**
 * Open start instants for one rink-day, earliest first. Candidates step
 * through the operating window; the ICE TIME must fit before close (the
 * trailing buffer may run past close — the flood after the last slot of the
 * night happens after hours everywhere).
 */
export function findOpenStartsForDay(input: FindSlotsDayInput): number[] {
  const { openMs, closeMs, blocked, durationMs, newBufferMs, stepMs, notBeforeMs, limit } = input
  if (durationMs <= 0 || stepMs <= 0 || limit <= 0) return []

  // First candidate: the open, advanced past notBefore and re-aligned to the
  // step grid (anchored at open, matching how the calendar grid snaps).
  let first = openMs
  if (notBeforeMs > first) {
    const offset = notBeforeMs - openMs
    first = openMs + Math.ceil(offset / stepMs) * stepMs
  }

  const sorted = [...blocked].sort((a, b) => a.startMs - b.startMs)
  const out: number[] = []

  for (let start = first; start + durationMs <= closeMs; start += stepMs) {
    const candidateEnd = start + durationMs + newBufferMs
    let clash = false
    for (const b of sorted) {
      if (b.startMs >= candidateEnd) break // sorted: nothing later can clash
      if (start < b.endMs && b.startMs < candidateEnd) {
        clash = true
        break
      }
    }
    if (!clash) {
      out.push(start)
      if (out.length >= limit) break
    }
  }
  return out
}
