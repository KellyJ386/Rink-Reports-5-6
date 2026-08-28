import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import type { InvoiceStatus } from "@/lib/rink-scheduling/ar"
import { createClient } from "@/lib/supabase/server"

import { InvoiceDetail } from "../_components/invoice-detail"
import { NotAvailable } from "../../_components/not-available"

export const dynamic = "force-dynamic"

export const metadata = { title: "Invoice | MFO / Rink Reports" }

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  const current = await requireUser()
  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return <NotAvailable />
  }

  const { invoiceId } = await params

  // RLS scopes this to the caller's facility, so a foreign id simply misses.
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
  if (!invoice) notFound()

  const [{ data: lines }, { data: payments }, { data: customer }, { data: methods }] =
    await Promise.all([
      supabase
        .from("rink_invoice_line_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("rink_payments")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("payment_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("rink_customers")
        .select("name, contact_email")
        .eq("id", invoice.customer_id)
        .maybeSingle(),
      supabase
        .from("rink_payment_methods")
        .select("id, name")
        .eq("facility_id", invoice.facility_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ])

  const methodName = new Map((methods ?? []).map((m) => [m.id, m.name]))

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <PageHeader
        title={invoice.invoice_number}
        description={customer?.name ?? "Customer"}
        actions={
          <Link
            href="/reports/rink-scheduling/invoices"
            className="text-muted-foreground text-sm no-underline hover:underline"
          >
            ← Invoices
          </Link>
        }
      />
      <InvoiceDetail
        invoice={{
          id: invoice.id,
          number: invoice.invoice_number,
          status: invoice.status as InvoiceStatus,
          issueDate: invoice.issue_date,
          dueDate: invoice.due_date,
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.tax_amount),
          taxRate: invoice.tax_rate === null ? null : Number(invoice.tax_rate),
          total: Number(invoice.total),
          amountPaid: Number(invoice.amount_paid),
          notes: invoice.notes,
          voidReason: invoice.void_reason,
          customerName: customer?.name ?? "Customer",
        }}
        lines={(lines ?? []).map((l) => ({
          id: l.id,
          description: l.description,
          quantityHours: Number(l.quantity_hours),
          unitRate: Number(l.unit_rate),
          amount: Number(l.amount),
          isManual: l.booking_id === null,
        }))}
        payments={(payments ?? []).map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paymentDate: p.payment_date,
          methodName: p.payment_method_id
            ? (methodName.get(p.payment_method_id) ?? null)
            : null,
          referenceNumber: p.reference_number,
          isReversal: p.reverses_payment_id !== null,
          notes: p.notes,
        }))}
        paymentMethods={methods ?? []}
      />
    </div>
  )
}
