import { renderToBuffer } from "@react-pdf/renderer"

import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { InvoicePdf } from "@/lib/rink-scheduling/invoice-pdf"
import { loadInvoicePdfData } from "@/lib/rink-scheduling/invoice-pdf-data"
import { createClient } from "@/lib/supabase/server"

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

  // Assembly shared with email delivery (deliver-invoice-email.tsx): the PDF
  // a biller downloads and the PDF a customer receives are the same document
  // by construction, not by coincidence.
  const { data } = await loadInvoicePdfData(supabase, invoice)

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
