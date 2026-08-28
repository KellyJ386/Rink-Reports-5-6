import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { formatMoney } from "@/lib/rink-scheduling/ar"
import type { InvoicePdfData } from "@/lib/rink-scheduling/invoice-pdf"
import type { createClient } from "@/lib/supabase/server"
import type { Database, Tables } from "@/types/database"
import { formatInTz } from "@/lib/timezone"

// Accepts the RLS-scoped server client (biller-facing paths) AND the
// service-role client (the overdue-reminder cron). The service caller is why
// every query filters explicitly rather than trusting a policy to scope it.
type ServerSupabase = Awaited<ReturnType<typeof createClient>> | SupabaseClient<Database>

/**
 * Assemble the full render model for an invoice document.
 *
 * Extracted from the PDF route so the PDF a biller downloads and the PDF a
 * customer is emailed are ALWAYS the same document — two copies of this
 * assembly would drift the moment one gained a field. The caller supplies the
 * already-fetched (and already access-checked) invoice row; every read here
 * goes through the caller's RLS-scoped client.
 */
export async function loadInvoicePdfData(
  supabase: ServerSupabase,
  invoice: Tables<"rink_invoices">,
): Promise<{ data: InvoicePdfData; timeZone: string | null }> {
  const [{ data: facility }, { data: customer }, { data: lines }] = await Promise.all([
    supabase
      .from("facilities")
      .select("name, address, city, state, zip_code, phone, email, timezone")
      .eq("id", invoice.facility_id)
      .maybeSingle(),
    supabase
      .from("rink_customers")
      .select(
        "name, contact_name, contact_email, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_zip",
      )
      .eq("id", invoice.customer_id)
      .maybeSingle(),
    supabase
      .from("rink_invoice_line_items")
      .select("description, quantity_hours, unit_rate, amount, sort_order")
      .eq("invoice_id", invoice.id)
      .order("sort_order", { ascending: true }),
  ])

  const timeZone = facility?.timezone ?? null
  const termsDays = Math.max(
    0,
    Math.round(
      (Date.parse(`${invoice.due_date}T00:00:00Z`) -
        Date.parse(`${invoice.issue_date}T00:00:00Z`)) /
        86_400_000,
    ),
  )

  const amountDueCents =
    Math.round(Number(invoice.total) * 100) -
    Math.round(Number(invoice.amount_paid) * 100)

  const data: InvoicePdfData = {
    facility: {
      name: facility?.name ?? "Facility",
      address: facility?.address ?? null,
      cityState:
        [facility?.city, facility?.state].filter(Boolean).join(", ") || null,
      zip: facility?.zip_code ?? null,
      phone: facility?.phone ?? null,
      email: facility?.email ?? null,
    },
    customer: {
      name: customer?.name ?? "Customer",
      contactName: customer?.contact_name ?? null,
      line1: customer?.billing_address_line1 ?? null,
      line2: customer?.billing_address_line2 ?? null,
      cityStateZip:
        [
          [customer?.billing_city, customer?.billing_state].filter(Boolean).join(", "),
          customer?.billing_zip,
        ]
          .filter(Boolean)
          .join(" ") || null,
      email: customer?.contact_email ?? null,
    },
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    paymentTerms: termsDays === 0 ? "Due on receipt" : `Net ${termsDays}`,
    lines: (lines ?? []).map((l) => ({
      description: l.description,
      quantityHours: Number(l.quantity_hours).toFixed(2),
      unitRate: formatMoney(l.unit_rate),
      amount: formatMoney(l.amount),
    })),
    subtotal: formatMoney(invoice.subtotal),
    // Null, not zero: a facility that charges no tax gets no tax line at all.
    taxAmount:
      invoice.tax_rate === null || invoice.tax_rate === undefined
        ? null
        : formatMoney(invoice.tax_amount),
    total: formatMoney(invoice.total),
    amountPaid: formatMoney(invoice.amount_paid),
    amountDue: formatMoney(amountDueCents / 100),
    notes: invoice.notes,
    // Facility-local, with an explicit zone — a UTC timestamp on a printed
    // invoice reads as the wrong day for anyone west of Greenwich.
    generatedAt: formatInTz(new Date().toISOString(), timeZone, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  }

  return { data, timeZone }
}
