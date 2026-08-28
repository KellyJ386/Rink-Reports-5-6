import { renderToBuffer } from "@react-pdf/renderer"

import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { formatMoney } from "@/lib/rink-scheduling/ar"
import { InvoicePdf, type InvoicePdfData } from "@/lib/rink-scheduling/invoice-pdf"
import { createClient } from "@/lib/supabase/server"
import { formatInTz } from "@/lib/timezone"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * On-demand invoice PDF.
 *
 * The invoice id is the only client input, and every read goes through the
 * caller's RLS-scoped client, so a user can only render invoices in their own
 * facility. The explicit permission check fails closed independently of RLS:
 * invoices are edit-tier, so a staff account cannot render one even if a
 * policy regressed.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const current = await requireUser()

  const { invoiceId } = await params
  if (!invoiceId || !UUID_RE.test(invoiceId)) {
    return new Response("Not found", { status: 404 })
  }

  const supabase = await createClient()
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return new Response("Forbidden", { status: 403 })
  }

  // Two gates, not one: RLS already scopes invoices to the caller's facility,
  // but every other read in this module ALSO filters explicitly so a single
  // policy regression cannot leak a foreign invoice (with its billing
  // address) through this route. A super admin keeps the RLS-wide view.
  let invoiceQuery = supabase.from("rink_invoices").select("*").eq("id", invoiceId)
  const callerFacilityId = current.profile?.facility_id ?? null
  if (callerFacilityId && !current.profile?.is_super_admin) {
    invoiceQuery = invoiceQuery.eq("facility_id", callerFacilityId)
  }
  const { data: invoice } = await invoiceQuery.maybeSingle()
  if (!invoice) return new Response("Not found", { status: 404 })

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
      .eq("invoice_id", invoiceId)
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

  // JSX rather than React.createElement: the element type React infers from
  // createElement is narrower than renderToBuffer's DocumentProps signature,
  // which is why every other PDF in this repo is written in a .tsx module.
  const buffer = await renderToBuffer(<InvoicePdf data={data} />)

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoice_number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  })
}
