import "server-only"

import { renderToBuffer } from "@react-pdf/renderer"

import { logServerError } from "@/lib/observability/log-server-error"
import { sendEmail, isEmailConfigured } from "@/lib/notifications/transport/email"
import { buildInvoiceEmail } from "@/lib/rink-scheduling/invoice-email"
import { InvoicePdf } from "@/lib/rink-scheduling/invoice-pdf"
import { loadInvoicePdfData } from "@/lib/rink-scheduling/invoice-pdf-data"
import type { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Every way delivery can end, as data rather than a thrown error: the caller
 * (a server action) turns each into user-facing wording, and NONE of them
 * roll back the state change that triggered the send — an invoice is
 * "issued" because the biller issued it, not because SMTP was reachable.
 */
export type InvoiceEmailOutcome =
  | { delivered: true; to: string }
  | { delivered: false; reason: "no_email" }
  | { delivered: false; reason: "not_configured" }
  | { delivered: false; reason: "failed"; to: string; detail: string }

/**
 * Render the invoice PDF and email it to the customer's billing contact.
 *
 * Reads through the caller's RLS-scoped client, so it can only ever deliver
 * an invoice the caller could already open. The PDF attached is byte-for-byte
 * the same document the /pdf route serves — both build from
 * loadInvoicePdfData, on purpose.
 */
export async function deliverInvoiceEmail(
  supabase: ServerSupabase,
  invoice: Tables<"rink_invoices">,
): Promise<InvoiceEmailOutcome> {
  const { data } = await loadInvoicePdfData(supabase, invoice)

  const to = (data.customer.email ?? "").trim()
  if (!to) return { delivered: false, reason: "no_email" }

  // Checked before the render so a facility without email credentials never
  // pays for PDF generation on every send click.
  if (!isEmailConfigured()) return { delivered: false, reason: "not_configured" }

  try {
    const buffer = await renderToBuffer(<InvoicePdf data={data} />)
    const message = buildInvoiceEmail({
      facilityName: data.facility.name,
      facilityEmail: data.facility.email,
      facilityPhone: data.facility.phone,
      invoiceNumber: data.invoiceNumber,
      customerName: data.customer.name,
      contactName: data.customer.contactName,
      total: data.total,
      amountDue: data.amountDue,
      dueDate: data.dueDate,
      paymentTerms: data.paymentTerms,
    })

    const sent = await sendEmail({
      to,
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      attachments: [
        {
          filename: `${data.invoiceNumber}.pdf`,
          content: buffer,
          contentType: "application/pdf",
        },
      ],
    })

    if (!sent.ok) return { delivered: false, reason: "failed", to, detail: sent.error }
    return { delivered: true, to }
  } catch (e) {
    logServerError("rink-scheduling/deliver-invoice-email", e)
    return {
      delivered: false,
      reason: "failed",
      to,
      detail: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
