// Pure rate resolution for Rink Scheduling & Billing.
//
// Dependency-free apart from src/lib/timezone.ts (Intl only, no server-only
// imports), so vitest can exercise it in a plain Node environment.
//
// THE MODEL, in one paragraph. A booking is stored as two UTC instants. Rates
// are authored in the FACILITY'S wall clock: prime windows are "Monday 17:00
// to 22:00 at the rink", not "22:00 UTC". So the engine projects the booking
// into facility-local minutes, slices it against that day's prime windows,
// prices each slice, and sums. A slot that straddles a boundary is genuinely
// two line segments at two rates — not one rate chosen by majority — because
// that is what the customer is charged for.
//
// Everything here is a PREVIEW. What actually reaches an invoice is the rate
// snapshotted onto the booking row at save time, so a later edit to a rate
// card can never restate a booking that already exists.

import {
  addDaysToKey,
  dayKeyInTz,
  minutesOfDayInTz,
  wallTimeToUtc,
  weekdayOfKey,
} from "@/lib/timezone"

export type PrimeWindow = {
  day_of_week: number
  start_time: string // "HH:MM" or "HH:MM:SS", facility-local
  end_time: string
}

export type RateCardLike = {
  id: string
  name: string
  effective_start: string // YYYY-MM-DD
  effective_end: string | null
  is_default: boolean
  hourly_rate_prime: number | string
  hourly_rate_nonprime: number | string
}

export type TypeOverrideLike = {
  rate_card_id: string
  booking_type_id: string
  hourly_rate_prime: number | string
  hourly_rate_nonprime: number | string
}

/** One priced slice of a booking. */
export type RateSegment = {
  startMs: number
  endMs: number
  hours: number
  isPrime: boolean
  hourlyRate: number
  amount: number
}

export type RateQuote = {
  segments: RateSegment[]
  totalHours: number
  /** Rounded to cents at the end, never per segment — see roundMoney. */
  totalAmount: number
  /** true = wholly prime, false = wholly non-prime, null = straddled both.
   *  Mirrors rink_bookings.rate_snapshot_prime. */
  allPrime: boolean | null
  /** The single rate to snapshot, or null when the slot straddled a boundary
   *  and no one number describes it. */
  snapshotHourlyRate: number | null
  rateCardId: string | null
  rateCardName: string | null
  /** Set when no card covers the date; the caller shows this rather than
   *  silently pricing at zero. */
  problem: string | null
}

function num(v: number | string): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Money is rounded once, at the total, not per segment: rounding each slice
 *  first lets two half-cent slices drift a cent away from the honest total. */
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * The rate card in effect on a given facility-local date.
 *
 * Prefers a default card, because non-default cards may overlap freely and
 * only the default set is guaranteed unambiguous (enforced by the
 * rink_rate_cards_no_default_overlap exclusion constraint). A customer's
 * explicitly chosen card is passed in as `preferredCardId` and wins outright.
 */
export function resolveRateCard(
  cards: RateCardLike[],
  dayKey: string,
  preferredCardId?: string | null,
): RateCardLike | null {
  const covering = cards.filter(
    (c) =>
      c.effective_start <= dayKey &&
      (c.effective_end === null || c.effective_end >= dayKey),
  )
  if (covering.length === 0) return null

  if (preferredCardId) {
    const preferred = covering.find((c) => c.id === preferredCardId)
    if (preferred) return preferred
  }

  const defaults = covering.filter((c) => c.is_default)
  if (defaults.length > 0) {
    // Latest start wins if somehow more than one qualifies.
    return defaults.reduce((a, b) =>
      a.effective_start >= b.effective_start ? a : b,
    )
  }
  return covering.reduce((a, b) =>
    a.effective_start >= b.effective_start ? a : b,
  )
}

/**
 * Prime windows for one facility-local weekday, normalised to minute ranges,
 * merged so overlapping windows cannot double-count an hour.
 */
export function primeRangesForDay(
  windows: PrimeWindow[],
  dayOfWeek: number,
): Array<{ start: number; end: number }> {
  const ranges = windows
    .filter((w) => w.day_of_week === dayOfWeek)
    .map((w) => ({ start: parseHm(w.start_time), end: parseHm(w.end_time) }))
    .filter(
      (r): r is { start: number; end: number } =>
        r.start !== null && r.end !== null && r.end > r.start,
    )
    .sort((a, b) => a.start - b.start)

  const merged: Array<{ start: number; end: number }> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

/**
 * Cut a booking into prime / non-prime slices.
 *
 * Walks the booking minute-window in facility-local terms. A booking crossing
 * midnight is handled by evaluating each calendar day it touches against that
 * day's own windows, which is why the boundaries are computed per local day
 * rather than once for the whole slot.
 */
/** UTC instant of `minutes` past local midnight on `dayKey`. Minute 1440 and
 *  beyond roll into the next day, defensively — window times are TIME columns
 *  and never reach it. */
function boundaryInstantMs(
  dayKey: string,
  minutes: number,
  timeZone: string | null,
): number | null {
  const day = minutes >= 1440 ? addDaysToKey(dayKey, 1) : dayKey
  const m = minutes >= 1440 ? minutes - 1440 : minutes
  const hh = String(Math.floor(m / 60)).padStart(2, "0")
  const mm = String(m % 60).padStart(2, "0")
  const d = wallTimeToUtc(`${day}T${hh}:${mm}`, timeZone)
  return d ? d.getTime() : null
}

function sliceByPrime(
  startMs: number,
  endMs: number,
  windows: PrimeWindow[],
  timeZone: string | null,
): Array<{ startMs: number; endMs: number; isPrime: boolean }> {
  const cuts = new Set<number>([startMs, endMs])

  // Walk every LOCAL CALENDAR DAY the booking touches — by day key, not by
  // 24-hour millisecond steps. Fixed-size steps have two DST failure modes:
  // on spring-forward a 24h hop can jump clean over a 23-hour day (so that
  // day's prime boundaries are never probed and a multi-day booking collapses
  // into one mispriced segment), and deriving "local midnight" as
  // `probe - minutesOfDay(probe)` assumes the UTC offset is constant between
  // midnight and the probe, which is exactly what a transition day breaks.
  // wallTimeToUtc's two-pass offset convergence answers "when is 17:00 on
  // this date" correctly on those days.
  const startKey = dayKeyInTz(new Date(startMs), timeZone)
  const endKey = dayKeyInTz(new Date(endMs), timeZone)
  for (let dayKey = startKey; dayKey <= endKey; dayKey = addDaysToKey(dayKey, 1)) {
    const dow = weekdayOfKey(dayKey)
    for (const r of primeRangesForDay(windows, dow)) {
      for (const boundary of [r.start, r.end]) {
        const ms = boundaryInstantMs(dayKey, boundary, timeZone)
        if (ms !== null && ms > startMs && ms < endMs) cuts.add(ms)
      }
    }
  }

  const ordered = Array.from(cuts).sort((a, b) => a - b)
  const out: Array<{ startMs: number; endMs: number; isPrime: boolean }> = []

  for (let i = 0; i < ordered.length - 1; i++) {
    const segStart = ordered[i]
    const segEnd = ordered[i + 1]
    if (segEnd <= segStart) continue

    // Classify by the segment's midpoint, which cannot sit exactly on a
    // boundary and so cannot be ambiguous.
    const mid = segStart + (segEnd - segStart) / 2
    const midDayKey = dayKeyInTz(new Date(mid), timeZone)
    const midDow = weekdayOfKey(midDayKey)
    const midMins = minutesOfDayInTz(new Date(mid), timeZone)
    const isPrime = primeRangesForDay(windows, midDow).some(
      (r) => midMins >= r.start && midMins < r.end,
    )

    const last = out[out.length - 1]
    if (last && last.isPrime === isPrime) {
      last.endMs = segEnd
    } else {
      out.push({ startMs: segStart, endMs: segEnd, isPrime })
    }
  }

  return out
}

export type QuoteInput = {
  startsAtMs: number
  endsAtMs: number
  timeZone: string | null
  cards: RateCardLike[]
  windows: PrimeWindow[]
  overrides: TypeOverrideLike[]
  bookingTypeId: string
  /** False for a Maintenance Block: it occupies ice but is never priced. */
  isBillable: boolean
  preferredCardId?: string | null
}

/**
 * Price a booking. Always returns a quote; `problem` explains any zero.
 */
export function quoteBooking(input: QuoteInput): RateQuote {
  const empty: RateQuote = {
    segments: [],
    totalHours: 0,
    totalAmount: 0,
    allPrime: null,
    snapshotHourlyRate: null,
    rateCardId: null,
    rateCardName: null,
    problem: null,
  }

  if (input.endsAtMs <= input.startsAtMs) {
    return { ...empty, problem: "The end time must be after the start time." }
  }

  const totalHours = (input.endsAtMs - input.startsAtMs) / 3_600_000

  if (!input.isBillable) {
    return {
      ...empty,
      totalHours,
      allPrime: null,
      problem: null,
    }
  }

  const dayKey = dayKeyInTz(new Date(input.startsAtMs), input.timeZone)
  const card = resolveRateCard(input.cards, dayKey, input.preferredCardId)
  if (!card) {
    return {
      ...empty,
      totalHours,
      problem:
        "No rate card covers this date, so the booking cannot be priced. Add one in Rink Scheduling admin.",
    }
  }

  const override = input.overrides.find(
    (o) => o.rate_card_id === card.id && o.booking_type_id === input.bookingTypeId,
  )
  const primeRate = num(override ? override.hourly_rate_prime : card.hourly_rate_prime)
  const nonPrimeRate = num(
    override ? override.hourly_rate_nonprime : card.hourly_rate_nonprime,
  )

  const slices = sliceByPrime(
    input.startsAtMs,
    input.endsAtMs,
    input.windows,
    input.timeZone,
  )

  const segments: RateSegment[] = slices.map((s) => {
    const hours = (s.endMs - s.startMs) / 3_600_000
    const hourlyRate = s.isPrime ? primeRate : nonPrimeRate
    return {
      startMs: s.startMs,
      endMs: s.endMs,
      hours,
      isPrime: s.isPrime,
      hourlyRate,
      amount: hours * hourlyRate,
    }
  })

  const rawTotal = segments.reduce((sum, s) => sum + s.amount, 0)
  const anyPrime = segments.some((s) => s.isPrime)
  const anyNonPrime = segments.some((s) => !s.isPrime)
  const allPrime = anyPrime && !anyNonPrime ? true : anyNonPrime && !anyPrime ? false : null

  return {
    segments: segments.map((s) => ({ ...s, amount: roundMoney(s.amount) })),
    totalHours,
    totalAmount: roundMoney(rawTotal),
    allPrime,
    // A straddling slot has no single honest rate, so nothing is snapshotted
    // and computed_amount carries the blended total instead.
    snapshotHourlyRate: allPrime === true ? primeRate : allPrime === false ? nonPrimeRate : null,
    rateCardId: card.id,
    rateCardName: card.name,
    problem: null,
  }
}

/** "1.5 h × $220.00 = $330.00" — the line the booking sheet shows per segment. */
export function describeSegment(seg: RateSegment): string {
  const hours = Number(seg.hours.toFixed(2))
  return `${hours} h × $${seg.hourlyRate.toFixed(2)} = $${seg.amount.toFixed(2)}`
}
