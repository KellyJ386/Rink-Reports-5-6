// Pure email copy for invoice delivery.
//
// Dependency-free so vitest runs it in plain Node. The server-only pieces —
// loading the invoice, rendering the PDF, calling Resend — live in
// deliver-invoice-email.tsx; this module only turns already-formatted facts
// into a subject and a body, so the words a customer receives are testable.
//
// THE AUDIENCE IS EXTERNAL. Everything else in this app talks to staff; this
// is the module's first message to a paying customer, so the copy carries the
// facility's identity (name, phone, reply address), never the app's, and the
// HTML is built from escaped values — a customer named "Smith & Sons <LLC>"
// must render as text, not markup.

export type InvoiceEmailInput = {
  facilityName: string
  facilityEmail: string | null
  facilityPhone: string | null
  invoiceNumber: string
  customerName: string
  contactName: string | null
  /** Preformatted money strings ("$1,234.00") — formatting stays in one
   *  place (formatMoney) rather than being re-implemented here. */
  total: string
  amountDue: string
  /** YYYY-MM-DD. Rendered long-form; parsed at UTC noon so the named day
   *  cannot shift in any zone. */
  dueDate: string
  paymentTerms: string
}

export type InvoiceEmail = {
  subject: string
  bodyText: string
  bodyHtml: string
}

/** "2026-09-25" -> "September 25, 2026". Falls back to the raw key when the
 *  input is not a well-formed date rather than throwing at send time. */
export function longDate(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!m) return dayKey
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  if (Number.isNaN(d.getTime())) return dayKey
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d)
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function buildInvoiceEmail(input: InvoiceEmailInput): InvoiceEmail {
  const due = longDate(input.dueDate)
  const greetTo = (input.contactName ?? "").trim() || input.customerName
  const subject = `Invoice ${input.invoiceNumber} from ${input.facilityName}`

  const contactLine = [input.facilityPhone, input.facilityEmail]
    .filter(Boolean)
    .join(" · ")

  const bodyText = [
    `Hi ${greetTo},`,
    "",
    `Invoice ${input.invoiceNumber} from ${input.facilityName} is attached as a PDF.`,
    "",
    `Amount due: ${input.amountDue}`,
    `Due date: ${due} (${input.paymentTerms})`,
    "",
    `Questions about this invoice? ${
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
    `<p>Invoice <strong>${e(input.invoiceNumber)}</strong> from ${e(input.facilityName)} is attached as a PDF.</p>`,
    `<p><strong>Amount due:</strong> ${e(input.amountDue)}<br/>`,
    `<strong>Due date:</strong> ${e(due)} (${e(input.paymentTerms)})</p>`,
    `<p>Questions about this invoice? ${
      contactLine
        ? `Reach us at ${e(contactLine)}.`
        : "Reply to this email and we&#39;ll get back to you."
    }</p>`,
    `<p>Thank you,<br/>${e(input.facilityName)}</p>`,
  ].join("\n")

  return { subject, bodyText, bodyHtml }
}
