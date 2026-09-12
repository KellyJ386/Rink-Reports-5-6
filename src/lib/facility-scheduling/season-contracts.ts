// Pure decision logic for season-contract invoicing and lifecycle.
//
// The cron applies these answers with a service client; keeping WHEN a
// contract is invoiced, for WHICH month, and when a season is finished as
// dependency-free arithmetic means the billing calendar is pinned by unit
// tests instead of discovered in production.
//
// All keys are facility-local: day keys "YYYY-MM-DD", period keys "YYYY-MM".

/** "2026-09-15" -> "2026-09". */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7)
}

/** Previous calendar month of a day key: "2026-01-05" -> "2025-12". */
export function previousMonthKey(dayKey: string): string {
  const y = Number(dayKey.slice(0, 4))
  const m = Number(dayKey.slice(5, 7))
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

/** First and last day key of a period: "2026-02" -> {from: 02-01, to: 02-28}. */
export function monthWindow(periodKey: string): { fromKey: string; toKey: string } {
  const y = Number(periodKey.slice(0, 4))
  const m = Number(periodKey.slice(5, 7))
  // Day 0 of the next month is the last day of this one; UTC keeps it pure.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    fromKey: `${periodKey}-01`,
    toKey: `${periodKey}-${String(last).padStart(2, "0")}`,
  }
}

export type ContractLike = {
  status: string
  /** YYYY-MM-DD. */
  seasonStart: string
  seasonEnd: string
  invoiceDayOfMonth: number
  /** YYYY-MM or null when never invoiced. */
  lastInvoicedPeriod: string | null
  autoInvoice: boolean
}

export type InvoiceDecision =
  | { due: true; periodKey: string }
  | {
      due: false
      reason:
        | "not_active"
        | "auto_invoice_off"
        | "too_early_in_month"
        | "period_not_elapsed"
        | "season_fully_invoiced"
    }

/**
 * Should this contract be invoiced today, and for which month?
 *
 * The billing model is ARREARS: on/after the contract's invoice day, the
 * PREVIOUS calendar month is billed. `>=` rather than `===` on the day makes
 * a missed cron self-healing — the first run after the invoice day catches
 * up, and last_invoiced_period stops it running twice.
 *
 * Only one period per run: a contract activated mid-season with months of
 * history bills one month per day rather than a surprise stack — visible,
 * bounded catch-up.
 */
export function decideContractInvoice(
  contract: ContractLike,
  todayKey: string,
): InvoiceDecision {
  if (contract.status !== "active") return { due: false, reason: "not_active" }
  if (!contract.autoInvoice) return { due: false, reason: "auto_invoice_off" }

  const dayOfMonth = Number(todayKey.slice(8, 10))
  if (dayOfMonth < contract.invoiceDayOfMonth) {
    return { due: false, reason: "too_early_in_month" }
  }

  const firstPeriod = monthKeyOf(contract.seasonStart)
  const finalPeriod = monthKeyOf(contract.seasonEnd)

  // The candidate is the month after the last one billed; with no history,
  // the season's FIRST month — a contract activated mid-season back-bills
  // from its start, one month per run, rather than silently skipping the
  // months the agreement covers.
  const candidate =
    contract.lastInvoicedPeriod === null
      ? firstPeriod
      : nextPeriod(contract.lastInvoicedPeriod)

  const periodKey = candidate < firstPeriod ? firstPeriod : candidate

  if (periodKey > finalPeriod) return { due: false, reason: "season_fully_invoiced" }
  // The period must be fully elapsed: bill month M only from M+1 onward.
  if (periodKey >= monthKeyOf(todayKey)) return { due: false, reason: "period_not_elapsed" }

  return { due: true, periodKey }
}

/** "2026-12" -> "2027-01". */
export function nextPeriod(periodKey: string): string {
  const y = Number(periodKey.slice(0, 4))
  const m = Number(periodKey.slice(5, 7))
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
}

/**
 * A contract completes itself once its season is over AND its final month has
 * been billed (or auto-invoicing is off, in which case season end is enough).
 */
export function shouldComplete(contract: ContractLike, todayKey: string): boolean {
  if (contract.status !== "active") return false
  if (todayKey <= contract.seasonEnd) return false
  if (!contract.autoInvoice) return true
  return (
    contract.lastInvoicedPeriod !== null &&
    contract.lastInvoicedPeriod >= monthKeyOf(contract.seasonEnd)
  )
}

/**
 * Renewal-desk helper: an active contract inside its final `windowDays` with
 * no renewal on file is the one worth a phone call.
 */
export function isExpiringSoon(
  contract: Pick<ContractLike, "status" | "seasonEnd">,
  todayKey: string,
  windowDays = 60,
): boolean {
  if (contract.status !== "active") return false
  if (todayKey > contract.seasonEnd) return false
  const parse = (k: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k)
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null
  }
  const today = parse(todayKey)
  const end = parse(contract.seasonEnd)
  if (today === null || end === null) return false
  return (end - today) / 86_400_000 <= windowDays
}

/** Season dates shifted one year forward for a renewal draft. Feb 29 clamps. */
export function shiftSeasonOneYear(dayKey: string): string {
  const y = Number(dayKey.slice(0, 4)) + 1
  const rest = dayKey.slice(4)
  if (rest === "-02-29") return `${y}-02-28`
  return `${y}${rest}`
}
