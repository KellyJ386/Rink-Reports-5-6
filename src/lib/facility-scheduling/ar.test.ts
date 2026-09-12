import { describe, expect, it } from "vitest"

import {
  agingBucket,
  buildAgingReport,
  buildLineDescription,
  centsToAmount,
  checkPayment,
  computeTotals,
  csvCell,
  daysBetween,
  deriveStatus,
  formatMoney,
  lineAmountCents,
  toCents,
  toCsv,
  type AgingInvoice,
} from "./ar"

describe("toCents", () => {
  it("accepts numbers and the strings Postgres returns for numerics", () => {
    expect(toCents(12.34)).toBe(1234)
    expect(toCents("12.34")).toBe(1234)
    expect(toCents("0.00")).toBe(0)
  })

  it("rounds half-cents rather than truncating them away", () => {
    expect(toCents(0.005)).toBe(1)
    expect(toCents(10.005)).toBe(1001)
  })

  it("treats null, undefined and nonsense as zero rather than NaN", () => {
    expect(toCents(null)).toBe(0)
    expect(toCents(undefined)).toBe(0)
    expect(toCents("abc")).toBe(0)
  })
})

describe("lineAmountCents", () => {
  it("multiplies hours by rate", () => {
    expect(lineAmountCents({ quantityHours: 1.5, unitRate: 300 })).toBe(45000)
    expect(lineAmountCents({ quantityHours: "2", unitRate: "220.50" })).toBe(44100)
  })
})

describe("computeTotals", () => {
  it("sums lines and applies tax to the subtotal", () => {
    const t = computeTotals([10000, 5000], 0.08)
    expect(t.subtotalCents).toBe(15000)
    expect(t.taxCents).toBe(1200)
    expect(t.totalCents).toBe(16200)
  })

  it("adds no tax line at all when the facility charges none", () => {
    const t = computeTotals([10000], null)
    expect(t.taxCents).toBe(0)
    expect(t.totalCents).toBe(10000)
  })

  it("taxes the SUBTOTAL once, not each line", () => {
    // Three lines that each land on a half cent of tax. Per-line rounding
    // would give 3 cents; taxing the subtotal gives the honest 2.
    const perLine = 3 * Math.round(3333 * 0.005)
    const t = computeTotals([3333, 3333, 3333], 0.005)
    expect(t.taxCents).toBe(Math.round(9999 * 0.005))
    expect(t.taxCents).not.toBe(perLine)
  })

  it("handles an empty invoice", () => {
    expect(computeTotals([], 0.08)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    })
  })

  it("does not drift when summing many lines", () => {
    // 0.10 x 30 in floating dollars famously drifts; integer cents do not.
    const lines = Array.from({ length: 30 }, () => lineAmountCents({ quantityHours: 1, unitRate: 0.1 }))
    expect(computeTotals(lines, null).subtotalCents).toBe(300)
    expect(centsToAmount(300)).toBe(3)
  })
})

describe("deriveStatus", () => {
  it("leaves a draft alone", () => {
    expect(deriveStatus("draft", 10000, 0)).toBe("draft")
  })

  it("keeps a sent invoice at sent when nothing is paid", () => {
    expect(deriveStatus("sent", 10000, 0)).toBe("sent")
  })

  it("moves to partially_paid on a part payment", () => {
    expect(deriveStatus("sent", 10000, 4000)).toBe("partially_paid")
  })

  it("moves to paid when the full amount is in", () => {
    expect(deriveStatus("partially_paid", 10000, 10000)).toBe("paid")
  })

  it("keeps a VOID invoice void even when payments exist against it", () => {
    // Voiding says the invoice is not valid; it does not erase money already
    // received, which stays on record.
    expect(deriveStatus("void", 10000, 10000)).toBe("void")
    expect(deriveStatus("void", 10000, 0)).toBe("void")
  })

  it("settles a sent zero-total invoice instead of stranding it", () => {
    expect(deriveStatus("sent", 0, 0)).toBe("paid")
  })

  it("falls back to sent when a reversal takes the balance back to nothing", () => {
    expect(deriveStatus("partially_paid", 10000, 0)).toBe("sent")
  })
})

describe("checkPayment", () => {
  it("accepts a payment up to the outstanding balance", () => {
    expect(checkPayment(50, 10000, 5000)).toEqual({ ok: true })
    expect(checkPayment("50.00", 10000, 5000)).toEqual({ ok: true })
  })

  it("BLOCKS an overpayment and says what is actually outstanding", () => {
    const r = checkPayment(150, 10000, 0)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("$100.00")
  })

  it("blocks payment against an already-settled invoice", () => {
    const r = checkPayment(10, 10000, 10000)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/paid in full/i)
  })

  it("rejects zero and points negatives at the reversal flow", () => {
    expect(checkPayment(0, 10000, 0).ok).toBe(false)
    const neg = checkPayment(-10, 10000, 0)
    expect(neg.ok).toBe(false)
    if (neg.ok) return
    expect(neg.error).toMatch(/reverse/i)
  })

  it("accepts a payment landing exactly on the balance", () => {
    expect(checkPayment(100, 10000, 0)).toEqual({ ok: true })
  })
})

describe("aging", () => {
  it("counts days from the DUE date", () => {
    expect(daysBetween("2026-09-01", "2026-09-15")).toBe(14)
    expect(daysBetween("2026-09-15", "2026-09-01")).toBe(-14)
  })

  it("treats a not-yet-due invoice as current, including on its due date", () => {
    expect(agingBucket("2026-09-30", "2026-09-15")).toBe("current")
    expect(agingBucket("2026-09-15", "2026-09-15")).toBe("current")
  })

  it("places each overdue span in the right bucket, including the edges", () => {
    expect(agingBucket("2026-09-14", "2026-09-15")).toBe("d1_30")
    expect(agingBucket("2026-08-16", "2026-09-15")).toBe("d1_30") // 30 days
    expect(agingBucket("2026-08-15", "2026-09-15")).toBe("d31_60") // 31
    expect(agingBucket("2026-07-17", "2026-09-15")).toBe("d31_60") // 60
    expect(agingBucket("2026-07-16", "2026-09-15")).toBe("d61_90") // 61
    expect(agingBucket("2026-06-17", "2026-09-15")).toBe("d61_90") // 90
    expect(agingBucket("2026-06-16", "2026-09-15")).toBe("d90_plus") // 91
  })
})

describe("buildAgingReport", () => {
  const today = "2026-09-15"

  function inv(over: Partial<AgingInvoice>): AgingInvoice {
    return {
      customerId: "c1",
      customerName: "Chargers",
      dueDate: "2026-09-30",
      totalCents: 10000,
      amountPaidCents: 0,
      status: "sent",
      ...over,
    }
  }

  it("groups outstanding balances by customer and bucket", () => {
    const r = buildAgingReport(
      [inv({}), inv({ dueDate: "2026-08-01", totalCents: 5000 })],
      today,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].buckets.current).toBe(10000)
    expect(r.rows[0].buckets.d31_60).toBe(5000)
    expect(r.grandTotalCents).toBe(15000)
  })

  it("counts only the UNPAID remainder of a part-paid invoice", () => {
    const r = buildAgingReport([inv({ amountPaidCents: 4000 })], today)
    expect(r.grandTotalCents).toBe(6000)
  })

  it("excludes drafts — nothing has been issued, so nothing is owed", () => {
    expect(buildAgingReport([inv({ status: "draft" })], today).rows).toHaveLength(0)
  })

  it("excludes void invoices", () => {
    expect(buildAgingReport([inv({ status: "void" })], today).rows).toHaveLength(0)
  })

  it("excludes fully paid invoices, so the report shows debt not history", () => {
    expect(
      buildAgingReport([inv({ status: "paid", amountPaidCents: 10000 })], today).rows,
    ).toHaveLength(0)
  })

  it("sorts customers by what they owe, largest first", () => {
    const r = buildAgingReport(
      [
        inv({ customerId: "a", customerName: "Small", totalCents: 1000 }),
        inv({ customerId: "b", customerName: "Big", totalCents: 90000 }),
      ],
      today,
    )
    expect(r.rows.map((x) => x.customerId)).toEqual(["b", "a"])
  })

  it("keeps bucket totals equal to the grand total", () => {
    const r = buildAgingReport(
      [
        inv({ dueDate: "2026-09-30" }),
        inv({ dueDate: "2026-09-01", customerId: "c2", customerName: "Blades" }),
        inv({ dueDate: "2026-05-01", customerId: "c3", customerName: "Comets" }),
      ],
      today,
    )
    const summed = Object.values(r.totals).reduce((a, b) => a + b, 0)
    expect(summed).toBe(r.grandTotalCents)
  })
})

describe("formatMoney", () => {
  it("formats dollars with thousands separators", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50")
    expect(formatMoney(0)).toBe("$0.00")
  })

  it("shows a reversal as negative", () => {
    expect(formatMoney(-50)).toBe("-$50.00")
  })
})

describe("csv", () => {
  it("quotes cells containing a comma, quote or newline", () => {
    // A customer called 'Ice, Inc.' must not shift every later column.
    expect(csvCell("Ice, Inc.")).toBe('"Ice, Inc."')
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
  })

  it("leaves ordinary cells untouched", () => {
    expect(csvCell("Chargers")).toBe("Chargers")
    expect(csvCell(42)).toBe("42")
    expect(csvCell(null)).toBe("")
  })

  it("joins rows with CRLF, which is what spreadsheets expect", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d")
  })
})

describe("buildLineDescription", () => {
  it("reads as an invoice line a customer can check against their calendar", () => {
    expect(
      buildLineDescription({
        typeName: "Ice Rental",
        rinkName: "Main Rink",
        dayKey: "2026-09-01",
        timeRange: "6:00 PM – 8:00 PM",
      }),
    ).toBe("Ice Rental — Main Rink — 2026-09-01 6:00 PM – 8:00 PM")
  })
})
