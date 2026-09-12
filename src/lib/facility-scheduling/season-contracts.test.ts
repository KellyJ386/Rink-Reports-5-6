import { describe, expect, it } from "vitest"

import {
  decideContractInvoice,
  isExpiringSoon,
  monthWindow,
  nextPeriod,
  previousMonthKey,
  shiftSeasonOneYear,
  shouldComplete,
  type ContractLike,
} from "./season-contracts"

function contract(over: Partial<ContractLike> = {}): ContractLike {
  return {
    status: "active",
    seasonStart: "2026-09-01",
    seasonEnd: "2027-03-31",
    invoiceDayOfMonth: 1,
    lastInvoicedPeriod: null,
    autoInvoice: true,
    ...over,
  }
}

describe("period arithmetic", () => {
  it("previous and next months cross year boundaries", () => {
    expect(previousMonthKey("2026-01-05")).toBe("2025-12")
    expect(previousMonthKey("2026-07-31")).toBe("2026-06")
    expect(nextPeriod("2026-12")).toBe("2027-01")
    expect(nextPeriod("2026-01")).toBe("2026-02")
  })

  it("month windows know their last day, February and leap years included", () => {
    expect(monthWindow("2026-02")).toEqual({ fromKey: "2026-02-01", toKey: "2026-02-28" })
    expect(monthWindow("2028-02")).toEqual({ fromKey: "2028-02-01", toKey: "2028-02-29" })
    expect(monthWindow("2026-12")).toEqual({ fromKey: "2026-12-01", toKey: "2026-12-31" })
  })
})

describe("decideContractInvoice", () => {
  it("bills the season's first month once it has fully elapsed", () => {
    expect(decideContractInvoice(contract(), "2026-09-15")).toEqual({
      due: false,
      reason: "period_not_elapsed",
    })
    expect(decideContractInvoice(contract(), "2026-10-01")).toEqual({
      due: true,
      periodKey: "2026-09",
    })
  })

  it("respects the invoice day, and >= makes a missed cron self-healing", () => {
    const c = contract({ invoiceDayOfMonth: 5 })
    expect(decideContractInvoice(c, "2026-10-04")).toEqual({
      due: false,
      reason: "too_early_in_month",
    })
    expect(decideContractInvoice(c, "2026-10-05")).toEqual({ due: true, periodKey: "2026-09" })
    // Cron was down on the 5th; the 9th still bills.
    expect(decideContractInvoice(c, "2026-10-09")).toEqual({ due: true, periodKey: "2026-09" })
  })

  it("advances one month at a time from the last invoiced period", () => {
    expect(
      decideContractInvoice(contract({ lastInvoicedPeriod: "2026-09" }), "2026-11-02"),
    ).toEqual({ due: true, periodKey: "2026-10" })
    // Same day, October already billed: November hasn't elapsed.
    expect(
      decideContractInvoice(contract({ lastInvoicedPeriod: "2026-10" }), "2026-11-02"),
    ).toEqual({ due: false, reason: "period_not_elapsed" })
  })

  it("a mid-season activation back-bills from the season start, one month per run", () => {
    expect(decideContractInvoice(contract(), "2027-01-03")).toEqual({
      due: true,
      periodKey: "2026-09",
    })
    expect(
      decideContractInvoice(contract({ lastInvoicedPeriod: "2026-09" }), "2027-01-03"),
    ).toEqual({ due: true, periodKey: "2026-10" })
  })

  it("stops after the season's final month", () => {
    expect(
      decideContractInvoice(contract({ lastInvoicedPeriod: "2027-03" }), "2027-04-10"),
    ).toEqual({ due: false, reason: "season_fully_invoiced" })
    // The final partial month itself still bills.
    expect(
      decideContractInvoice(contract({ lastInvoicedPeriod: "2027-02" }), "2027-04-01"),
    ).toEqual({ due: true, periodKey: "2027-03" })
  })

  it("draft, cancelled, completed, and auto-invoice-off never bill", () => {
    for (const status of ["draft", "cancelled", "completed"]) {
      expect(decideContractInvoice(contract({ status }), "2026-10-01")).toEqual({
        due: false,
        reason: "not_active",
      })
    }
    expect(
      decideContractInvoice(contract({ autoInvoice: false }), "2026-10-01"),
    ).toEqual({ due: false, reason: "auto_invoice_off" })
  })
})

describe("shouldComplete", () => {
  it("completes only past season end with the final month billed", () => {
    expect(shouldComplete(contract(), "2027-03-31")).toBe(false)
    expect(shouldComplete(contract({ lastInvoicedPeriod: "2027-02" }), "2027-04-05")).toBe(false)
    expect(shouldComplete(contract({ lastInvoicedPeriod: "2027-03" }), "2027-04-05")).toBe(true)
  })

  it("with auto-invoicing off, season end alone completes it", () => {
    expect(shouldComplete(contract({ autoInvoice: false }), "2027-04-01")).toBe(true)
  })

  it("only active contracts complete", () => {
    expect(shouldComplete(contract({ status: "draft" }), "2028-01-01")).toBe(false)
  })
})

describe("isExpiringSoon", () => {
  it("flags the final 60 days of an active season, not after it", () => {
    expect(isExpiringSoon(contract(), "2027-01-29")).toBe(false) // 61 days out
    expect(isExpiringSoon(contract(), "2027-01-30")).toBe(true) // 60 days out
    expect(isExpiringSoon(contract(), "2027-03-31")).toBe(true)
    expect(isExpiringSoon(contract(), "2027-04-01")).toBe(false)
    expect(isExpiringSoon(contract({ status: "completed" }), "2027-03-01")).toBe(false)
  })
})

describe("shiftSeasonOneYear", () => {
  it("adds a year, clamping Feb 29", () => {
    expect(shiftSeasonOneYear("2026-09-01")).toBe("2027-09-01")
    expect(shiftSeasonOneYear("2028-02-29")).toBe("2029-02-28")
  })
})
