import { describe, expect, it } from "vitest"

import { buildBookingConfirmationEmail, type BookingEmailInput } from "./booking-email"
import { buildOverdueReminderEmail } from "./invoice-email"

function input(over: Partial<BookingEmailInput> = {}): BookingEmailInput {
  return {
    facilityName: "Tennity Ice Skating Pavilion",
    facilityEmail: "office@tennity.example",
    facilityPhone: "(315) 555-0100",
    customerName: "SU Club Hockey",
    contactName: "Jordan Vaughn",
    title: null,
    typeName: "Practice",
    rinkName: "North Rink",
    dayKey: "2026-09-12",
    timeRange: "5:00 PM – 6:30 PM",
    status: "confirmed",
    amount: "$450.00",
    ...over,
  }
}

describe("buildBookingConfirmationEmail", () => {
  it("confirmed bookings say so in the subject and body", () => {
    const m = buildBookingConfirmationEmail(input())
    expect(m.subject).toBe("Your ice time at Tennity Ice Skating Pavilion is confirmed")
    expect(m.bodyText).toContain("Your booking is confirmed.")
  })

  it("tentative bookings are reserved, not confirmed", () => {
    const m = buildBookingConfirmationEmail(input({ status: "tentative" }))
    expect(m.subject).toContain("pending confirmation")
    expect(m.bodyText).toContain("awaiting final confirmation")
    expect(m.bodyText).not.toContain("Your booking is confirmed.")
  })

  it("lists date, time, rink and the estimated charge", () => {
    const m = buildBookingConfirmationEmail(input())
    expect(m.bodyText).toContain("When: September 12, 2026, 5:00 PM – 6:30 PM")
    expect(m.bodyText).toContain("Where: North Rink, Tennity Ice Skating Pavilion")
    expect(m.bodyText).toContain("Estimated ice charge: $450.00")
  })

  it("omits the charge line entirely for unpriced bookings", () => {
    const m = buildBookingConfirmationEmail(input({ amount: null }))
    expect(m.bodyText).not.toContain("Estimated ice charge")
    expect(m.bodyHtml).not.toContain("Estimated ice charge")
  })

  it("a booking title outranks the type name; without one the type carries it", () => {
    expect(buildBookingConfirmationEmail(input({ title: "Championship warm-up" })).bodyText).toContain(
      "What: Championship warm-up",
    )
    expect(buildBookingConfirmationEmail(input()).bodyText).toContain("What: Practice")
  })

  it("greets the contact, falls back to the customer name", () => {
    expect(buildBookingConfirmationEmail(input()).bodyText).toContain("Hi Jordan Vaughn,")
    expect(
      buildBookingConfirmationEmail(input({ contactName: null })).bodyText,
    ).toContain("Hi SU Club Hockey,")
  })

  it("escapes hostile values in the HTML body only", () => {
    const m = buildBookingConfirmationEmail(
      input({ contactName: null, customerName: "A&B <Youth> Hockey" }),
    )
    expect(m.bodyHtml).toContain("A&amp;B &lt;Youth&gt; Hockey")
    expect(m.bodyHtml).not.toContain("<Youth>")
    expect(m.bodyText).toContain("A&B <Youth> Hockey")
  })
})

describe("buildOverdueReminderEmail", () => {
  const reminder = {
    facilityName: "Tennity Ice Skating Pavilion",
    facilityEmail: "billing@tennity.example",
    facilityPhone: "(315) 555-0100",
    invoiceNumber: "INV-0042",
    customerName: "SU Club Hockey",
    contactName: "Jordan Vaughn",
    amountDue: "$750.00",
    dueDate: "2026-08-15",
    paymentTerms: "Net 30",
    daysOverdue: 13,
  }

  it("subjects with the invoice number and says how late it is", () => {
    const m = buildOverdueReminderEmail(reminder)
    expect(m.subject).toBe(
      "Reminder: invoice INV-0042 from Tennity Ice Skating Pavilion is past due",
    )
    expect(m.bodyText).toContain("13 days past due")
    expect(m.bodyText).toContain("Amount due: $750.00")
    expect(m.bodyText).toContain("Due date: August 15, 2026 (Net 30)")
  })

  it("uses the singular for one day", () => {
    expect(
      buildOverdueReminderEmail({ ...reminder, daysOverdue: 1 }).bodyText,
    ).toContain("1 day past due")
  })

  it("escapes hostile names in HTML", () => {
    const m = buildOverdueReminderEmail({
      ...reminder,
      contactName: null,
      customerName: "Smith & Sons <LLC>",
    })
    expect(m.bodyHtml).toContain("Smith &amp; Sons &lt;LLC&gt;")
    expect(m.bodyHtml).not.toContain("<LLC>")
  })
})
