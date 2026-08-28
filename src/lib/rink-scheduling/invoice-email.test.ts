import { describe, expect, it } from "vitest"

import {
  buildInvoiceEmail,
  escapeHtml,
  longDate,
  type InvoiceEmailInput,
} from "./invoice-email"

function input(over: Partial<InvoiceEmailInput> = {}): InvoiceEmailInput {
  return {
    facilityName: "Tennity Ice Skating Pavilion",
    facilityEmail: "billing@tennity.example",
    facilityPhone: "(315) 555-0100",
    invoiceNumber: "INV-0042",
    customerName: "SU Club Hockey",
    contactName: "Jordan Vaughn",
    total: "$1,250.00",
    amountDue: "$1,250.00",
    dueDate: "2026-09-25",
    paymentTerms: "Net 30",
    ...over,
  }
}

describe("longDate", () => {
  it("renders a day key long-form, independent of any zone", () => {
    expect(longDate("2026-09-25")).toBe("September 25, 2026")
    expect(longDate("2026-01-01")).toBe("January 1, 2026")
    expect(longDate("2026-12-31")).toBe("December 31, 2026")
  })

  it("passes malformed input through rather than throwing at send time", () => {
    expect(longDate("not-a-date")).toBe("not-a-date")
    expect(longDate("")).toBe("")
  })
})

describe("escapeHtml", () => {
  it("neutralizes markup-significant characters", () => {
    expect(escapeHtml('Smith & Sons <LLC> "quoted"')).toBe(
      "Smith &amp; Sons &lt;LLC&gt; &quot;quoted&quot;",
    )
  })
})

describe("buildInvoiceEmail", () => {
  it("subjects with the invoice number and the facility's identity", () => {
    const m = buildInvoiceEmail(input())
    expect(m.subject).toBe("Invoice INV-0042 from Tennity Ice Skating Pavilion")
  })

  it("greets the contact person and falls back to the customer name", () => {
    expect(buildInvoiceEmail(input()).bodyText).toContain("Hi Jordan Vaughn,")
    expect(buildInvoiceEmail(input({ contactName: null })).bodyText).toContain(
      "Hi SU Club Hockey,",
    )
    expect(buildInvoiceEmail(input({ contactName: "   " })).bodyText).toContain(
      "Hi SU Club Hockey,",
    )
  })

  it("states the amount due, the long-form due date, and the terms", () => {
    const m = buildInvoiceEmail(input())
    expect(m.bodyText).toContain("Amount due: $1,250.00")
    expect(m.bodyText).toContain("Due date: September 25, 2026 (Net 30)")
    expect(m.bodyHtml).toContain("September 25, 2026")
  })

  it("offers the facility's contact line, or a reply-to fallback without one", () => {
    const withContact = buildInvoiceEmail(input())
    expect(withContact.bodyText).toContain(
      "Reach us at (315) 555-0100 · billing@tennity.example.",
    )
    const bare = buildInvoiceEmail(
      input({ facilityEmail: null, facilityPhone: null }),
    )
    expect(bare.bodyText).toContain("Reply to this email")
  })

  it("escapes hostile names in the HTML body but not the text body", () => {
    const m = buildInvoiceEmail(
      input({ customerName: 'Smith & Sons <img src=x>', contactName: null }),
    )
    expect(m.bodyHtml).toContain("Smith &amp; Sons &lt;img src=x&gt;")
    expect(m.bodyHtml).not.toContain("<img")
    expect(m.bodyText).toContain("Smith & Sons <img src=x>")
  })

  it("never mentions the app — the sender is the facility", () => {
    const m = buildInvoiceEmail(input())
    expect(m.bodyText).not.toMatch(/rink reports/i)
    expect(m.bodyText.endsWith("Tennity Ice Skating Pavilion")).toBe(true)
  })
})
