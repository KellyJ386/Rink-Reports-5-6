// Pure, dependency-free 5-field cron evaluator used by the recurring-reminders
// worker (`/api/cron/run-reminders`). Supports the standard fields
//   minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, Sun=0; 7=Sun)
// with `*`, lists (`,`), ranges (`a-b`), and steps (`*/n`, `a-b/n`, `a/n`).
//
// Evaluation is timezone-aware: candidate instants are matched against their
// wall-clock parts in the supplied IANA timezone, so an admin's "0 9 * * 1"
// fires at 09:00 local Monday, not 09:00 UTC.

export type CronField = ReadonlySet<number>
export type CronFields = {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
  /** True when day-of-month / day-of-week were explicitly restricted (not "*"). */
  domRestricted: boolean
  dowRestricted: boolean
}

type Range = { min: number; max: number }
const RANGES: Record<keyof Omit<CronFields, "domRestricted" | "dowRestricted">, Range> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 6 },
}

function parseField(token: string, range: Range): Set<number> | null {
  const out = new Set<number>()
  for (const part of token.split(",")) {
    const piece = part.trim()
    if (piece === "") return null
    // Optional step: "<base>/<step>"
    const [baseRaw, stepRaw, ...rest] = piece.split("/")
    if (rest.length > 0) return null
    let step = 1
    if (stepRaw !== undefined) {
      step = Number(stepRaw)
      if (!Number.isInteger(step) || step <= 0) return null
    }
    let lo = range.min
    let hi = range.max
    const base = baseRaw.trim()
    if (base !== "*") {
      const [aRaw, bRaw, ...more] = base.split("-")
      if (more.length > 0) return null
      const a = Number(aRaw)
      if (!Number.isInteger(a)) return null
      lo = a
      if (bRaw !== undefined) {
        const b = Number(bRaw)
        if (!Number.isInteger(b)) return null
        hi = b
      } else {
        // A bare number with no step is a single value; with a step it's a-max.
        hi = stepRaw !== undefined ? range.max : a
      }
    }
    if (lo < range.min || hi > range.max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size > 0 ? out : null
}

/** Parse a 5-field cron expression; returns null if malformed. */
export function parseCron(expr: string): CronFields | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseField(fields[0], RANGES.minute)
  const hour = parseField(fields[1], RANGES.hour)
  const dom = parseField(fields[2], RANGES.dom)
  const month = parseField(fields[3], RANGES.month)
  // day-of-week: accept 7 as Sunday by normalizing to 0.
  const dowRaw = parseField(fields[4].replace(/7/g, "0"), RANGES.dow)
  if (!minute || !hour || !dom || !month || !dowRaw) return null
  return {
    minute,
    hour,
    dom,
    month,
    dow: dowRaw,
    domRestricted: fields[2].trim() !== "*",
    dowRestricted: fields[4].trim() !== "*",
  }
}

type WallParts = {
  minute: number
  hour: number
  dom: number
  month: number
  dow: number
}

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/** Wall-clock parts of an instant in the given IANA timezone (UTC fallback). */
export function wallPartsInTimeZone(date: Date, timeZone: string): WallParts {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hourCycle: "h23",
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
  }
  const parts = fmt.formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return {
    minute: Number(get("minute")),
    hour: Number(get("hour")),
    dom: Number(get("day")),
    month: Number(get("month")),
    dow: WEEKDAY_TO_NUM[get("weekday")] ?? 0,
  }
}

function matches(fields: CronFields, p: WallParts): boolean {
  if (!fields.minute.has(p.minute)) return false
  if (!fields.hour.has(p.hour)) return false
  if (!fields.month.has(p.month)) return false
  // Standard cron: when BOTH dom and dow are restricted, match on EITHER.
  const domOk = fields.dom.has(p.dom)
  const dowOk = fields.dow.has(p.dow)
  if (fields.domRestricted && fields.dowRestricted) return domOk || dowOk
  if (fields.domRestricted) return domOk
  if (fields.dowRestricted) return dowOk
  return true
}

const MAX_LOOKAHEAD_MINUTES = 366 * 24 * 60

/**
 * The next instant strictly after `from` that matches `expr` in `timeZone`.
 * Returns null for a malformed expression or if no match within ~366 days.
 */
export function nextRunAfter(
  expr: string,
  from: Date,
  timeZone: string,
): Date | null {
  const fields = parseCron(expr)
  if (!fields) return null
  // Start at the next whole minute after `from`.
  const start = new Date(from.getTime())
  start.setUTCSeconds(0, 0)
  start.setUTCMinutes(start.getUTCMinutes() + 1)
  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i++) {
    const candidate = new Date(start.getTime() + i * 60_000)
    if (matches(fields, wallPartsInTimeZone(candidate, timeZone))) {
      return candidate
    }
  }
  return null
}

/** Whether a cron expression is valid (for form validation). */
export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null
}
