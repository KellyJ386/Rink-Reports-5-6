// Pure accounts-receivable logic for Rink Scheduling & Billing.
//
// Dependency-free: no server-only imports, so vitest exercises it directly.
// Every rule that decides an amount or a status lives here rather than inline
// in a server action, because these are the rules a facility will be audited
// on and they deserve tests.
//
// MONEY CONVENTIONS
//   * Cents are the unit of truth for arithmetic. Summing floating-point
//     dollars across thirty line items drifts; summing integer cents does not.
//     Values arrive as numeric strings or numbers from Postgres and are
//     converted once, at the edge.
//   * Rounding happens once, at the point a total is formed — never per line.
//   * A payment is positive; a reversal is negative and references the payment
//     it reverses. The sum of the rows IS the amount paid, so a reversed
//     payment needs no special case anywhere downstream.

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "void"

/** Postgres numerics arrive as strings often enough that this must be safe. */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100
}

export function formatMoney(value: number | string | null | undefined): string {
  const cents = toCents(value)
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  return `${sign}$${Math.floor(abs / 100).toLocaleString()}.${String(abs % 100).padStart(2, "0")}`
}

export type LineItemInput = {
  quantityHours: number | string
  unitRate: number | string
}

/** Line amount, rounded to the cent once. */
export function lineAmountCents(line: LineItemInput): number {
  const hours = typeof line.quantityHours === "number" ? line.quantityHours : Number(line.quantityHours)
  const rate = typeof line.unitRate === "number" ? line.unitRate : Number(line.unitRate)
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return 0
  return Math.round(hours * rate * 100)
}

export type InvoiceTotals = {
  subtotalCents: number
  taxCents: number
  totalCents: number
}

/**
 * Totals for a set of line amounts.
 *
 * Tax is computed on the SUBTOTAL, once — not per line. Taxing each line and
 * summing produces a different (and wrong) number whenever a line's tax lands
 * on a half cent, and the difference is exactly the kind of penny discrepancy
 * that makes a customer distrust an invoice.
 *
 * `taxRate` is a FRACTION (0.0875), matching the column. Null means the
 * facility charges no tax and the invoice carries no tax line at all — which
 * is a different statement from a rate of zero.
 */
export function computeTotals(
  lineAmountsCents: number[],
  taxRate: number | null,
): InvoiceTotals {
  const subtotalCents = lineAmountsCents.reduce((sum, c) => sum + Math.round(c), 0)
  const taxCents =
    taxRate === null || taxRate === undefined
      ? 0
      : Math.round(subtotalCents * taxRate)
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents }
}

/**
 * The paid status is DERIVED from the payment sum and is never set by hand.
 *
 * A void invoice stays void whatever has been paid against it: voiding is a
 * statement about the invoice's validity, not about the money, and the
 * payments remain on record.
 */
export function deriveStatus(
  current: InvoiceStatus,
  totalCents: number,
  amountPaidCents: number,
): InvoiceStatus {
  if (current === "void") return "void"
  if (current === "draft") return "draft"

  // Order matters. A sent invoice with nothing to pay is settled, and this has
  // to be decided BEFORE the "nothing paid yet" branch — otherwise a $0
  // invoice (an internal program, a fully-discounted booking) is stranded at
  // "sent" forever, showing on the AR report as owing nothing.
  if (totalCents <= 0) return "paid"

  if (amountPaidCents <= 0) return "sent"
  if (amountPaidCents >= totalCents) return "paid"
  return "partially_paid"
}

export type PaymentCheck =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Overpayment is blocked, not warned about: an invoice that shows more paid
 * than owed corrupts the aging report and the customer statement, and the
 * legitimate cases (a credit, a deposit against future ice) are different
 * transactions that deserve their own record.
 */
export function checkPayment(
  amount: number | string,
  totalCents: number,
  alreadyPaidCents: number,
): PaymentCheck {
  const cents = toCents(amount)
  if (cents === 0) return { ok: false, error: "Enter a payment amount." }
  if (cents < 0) {
    return {
      ok: false,
      error: "Payments are positive. To undo one, reverse the original payment.",
    }
  }
  const remaining = totalCents - alreadyPaidCents
  if (remaining <= 0) {
    return { ok: false, error: "This invoice is already paid in full." }
  }
  if (cents > remaining) {
    return {
      ok: false,
      error: `That is more than the ${formatMoney(centsToAmount(remaining))} outstanding. Record the exact amount, or split it across invoices.`,
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus"

export const AGING_BUCKETS: ReadonlyArray<{ key: AgingBucket; label: string }> = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d61_90", label: "61–90 days" },
  { key: "d90_plus", label: "90+ days" },
]

/** Whole days between two date keys, positive when `later` is after `earlier`. */
export function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`)
  const b = Date.parse(`${later}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * Which bucket an invoice falls into.
 *
 * "Current" means not yet due — an invoice due tomorrow is not overdue, and
 * counting it as such would make every report alarming. Overdue days are
 * measured from the DUE date, not the issue date.
 */
export function agingBucket(dueDate: string, todayKey: string): AgingBucket {
  const overdueDays = daysBetween(dueDate, todayKey)
  if (overdueDays <= 0) return "current"
  if (overdueDays <= 30) return "d1_30"
  if (overdueDays <= 60) return "d31_60"
  if (overdueDays <= 90) return "d61_90"
  return "d90_plus"
}

export type AgingInvoice = {
  customerId: string
  customerName: string
  dueDate: string
  totalCents: number
  amountPaidCents: number
  status: InvoiceStatus
}

export type AgingRow = {
  customerId: string
  customerName: string
  buckets: Record<AgingBucket, number>
  totalCents: number
}

export type AgingReport = {
  rows: AgingRow[]
  totals: Record<AgingBucket, number>
  grandTotalCents: number
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }
}

/**
 * Aging by customer, on OUTSTANDING balances.
 *
 * Draft and void invoices are excluded: a draft has not been issued so nothing
 * is owed, and a void invoice is a statement that nothing is owed. Fully paid
 * invoices contribute nothing and are dropped so the report shows debt rather
 * than history.
 */
export function buildAgingReport(
  invoices: AgingInvoice[],
  todayKey: string,
): AgingReport {
  const byCustomer = new Map<string, AgingRow>()
  const totals = emptyBuckets()
  let grandTotalCents = 0

  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "void") continue
    const outstanding = inv.totalCents - inv.amountPaidCents
    if (outstanding <= 0) continue

    const bucket = agingBucket(inv.dueDate, todayKey)
    let row = byCustomer.get(inv.customerId)
    if (!row) {
      row = {
        customerId: inv.customerId,
        customerName: inv.customerName,
        buckets: emptyBuckets(),
        totalCents: 0,
      }
      byCustomer.set(inv.customerId, row)
    }
    row.buckets[bucket] += outstanding
    row.totalCents += outstanding
    totals[bucket] += outstanding
    grandTotalCents += outstanding
  }

  const rows = Array.from(byCustomer.values()).sort(
    (a, b) => b.totalCents - a.totalCents || a.customerName.localeCompare(b.customerName),
  )

  return { rows, totals, grandTotalCents }
}

/** Description line for a booking on an invoice. Facility-local times are
 *  formatted by the caller, which owns the zone. */
export function buildLineDescription(parts: {
  typeName: string
  rinkName: string
  dayKey: string
  timeRange: string
}): string {
  return `${parts.typeName} — ${parts.rinkName} — ${parts.dayKey} ${parts.timeRange}`
}

/** CSV cell escaping: quote anything containing a delimiter, quote or newline,
 *  and double any embedded quotes. A customer called "Ice, Inc." must not
 *  silently shift every column after it. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n")
}
