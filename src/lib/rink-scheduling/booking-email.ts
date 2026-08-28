// Pure email copy for booking confirmations.
//
// Same contract as invoice-email.ts: dependency-free so vitest runs it in
// plain Node, external audience, the facility's identity throughout — never
// the app's — and every HTML interpolation escaped. The server-only delivery
// (fetching the booking, checking the facility's opt-in, calling the
// transport) lives in deliver-booking-email.ts.

import { escapeHtml, longDate } from "./invoice-email"

export type BookingEmailInput = {
  facilityName: string
  facilityEmail: string | null
  facilityPhone: string | null
  customerName: string
  contactName: string | null
  /** Booking title if one was given; otherwise the booking type carries it. */
  title: string | null
  typeName: string
  rinkName: string
  /** YYYY-MM-DD in the FACILITY's zone. */
  dayKey: string
  /** Already facility-zoned, e.g. "5:00 PM – 6:30 PM". */
  timeRange: string
  status: "tentative" | "confirmed"
  /** Preformatted ("$450.00"), or null when the booking is unpriced or free. */
  amount: string | null
}

export type BookingEmail = {
  subject: string
  bodyText: string
  bodyHtml: string
}

export function buildBookingConfirmationEmail(input: BookingEmailInput): BookingEmail {
  const greetTo = (input.contactName ?? "").trim() || input.customerName
  const date = longDate(input.dayKey)
  const what = (input.title ?? "").trim() || input.typeName
  const confirmed = input.status === "confirmed"

  const subject = confirmed
    ? `Your ice time at ${input.facilityName} is confirmed`
    : `Your ice time at ${input.facilityName} is reserved (pending confirmation)`

  const statusLine = confirmed
    ? "Your booking is confirmed. We look forward to seeing you on the ice."
    : "Your booking is reserved and awaiting final confirmation from our staff. We'll be in touch if anything changes."

  const contactLine = [input.facilityPhone, input.facilityEmail]
    .filter(Boolean)
    .join(" · ")

  const detailLines = [
    `What: ${what}`,
    `When: ${date}, ${input.timeRange}`,
    `Where: ${input.rinkName}, ${input.facilityName}`,
    ...(input.amount !== null ? [`Estimated ice charge: ${input.amount}`] : []),
  ]

  const bodyText = [
    `Hi ${greetTo},`,
    "",
    statusLine,
    "",
    ...detailLines,
    "",
    `Need to make a change? ${
      contactLine
        ? `Reach us at ${contactLine}.`
        : "Reply to this email and we'll get back to you."
    }`,
    "",
    `Thank you,`,
    input.facilityName,
  ].join("\n")

  const e = escapeHtml
  const bodyHtml = [
    `<p>Hi ${e(greetTo)},</p>`,
    `<p>${e(statusLine)}</p>`,
    `<p>${detailLines.map((l) => e(l)).join("<br/>")}</p>`,
    `<p>Need to make a change? ${
      contactLine
        ? `Reach us at ${e(contactLine)}.`
        : "Reply to this email and we&#39;ll get back to you."
    }</p>`,
    `<p>Thank you,<br/>${e(input.facilityName)}</p>`,
  ].join("\n")

  return { subject, bodyText, bodyHtml }
}
