// Shared date-range + row-cap policy for the Air Quality monitoring log
// (screen, PDF download, and emailed PDF). The log renders every reading in the
// range into an @react-pdf/renderer document — a library with a heavy memory
// footprint — so an unbounded range or an unbounded row count could time out or
// OOM the PDF route / email action on a facility with a long history.
//
// Two bounds, mirroring the exports module (EXPORT_MAX_RANGE_DAYS /
// EXPORT_ROW_LIMIT):
//   - the requested span is clamped to AQ_LOG_MAX_RANGE_DAYS. The clamp moves
//     `from` forward, and every output echoes the resolved range (PDF header,
//     filename, email subject), so it is self-documenting rather than silently
//     wrong.
//   - AQ_LOG_ROW_LIMIT is a hard ceiling on the reports query as a safety net
//     for an extreme submission density even inside the capped span.

export const AQ_LOG_MAX_RANGE_DAYS = 366
export const AQ_LOG_ROW_LIMIT = 2000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
/** Default lookback when no valid `from` is supplied. */
const DEFAULT_LOOKBACK_DAYS = 90

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dayMs(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`)
}

export type ResolvedLogRange = {
  from: string
  to: string
  /** True when the requested span exceeded the cap and `from` was moved up. */
  clamped: boolean
}

/**
 * Normalize a raw (from, to) pair into a validated, span-capped range.
 * Invalid/missing bounds fall back to today and a 90-day lookback. `to` is
 * inclusive; callers derive their own end-of-day upper bound.
 */
export function resolveLogRange(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
): ResolvedLogRange {
  const to = toRaw && DATE_RE.test(toRaw) ? toRaw : isoDate(new Date())
  const toMs = dayMs(to)

  let from =
    fromRaw && DATE_RE.test(fromRaw)
      ? fromRaw
      : isoDate(new Date(toMs - DEFAULT_LOOKBACK_DAYS * DAY_MS))

  // A `from` after `to` is meaningless — fall back to the default lookback.
  if (dayMs(from) > toMs) {
    from = isoDate(new Date(toMs - DEFAULT_LOOKBACK_DAYS * DAY_MS))
  }

  const minFromMs = toMs - AQ_LOG_MAX_RANGE_DAYS * DAY_MS
  let clamped = false
  if (dayMs(from) < minFromMs) {
    from = isoDate(new Date(minFromMs))
    clamped = true
  }

  return { from, to, clamped }
}
