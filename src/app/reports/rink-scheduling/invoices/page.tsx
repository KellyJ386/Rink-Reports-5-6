import Link from "next/link"

import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { currentUserCan } from "@/lib/permissions/check"
import {
  buildAgingReport,
  toCents,
  type AgingInvoice,
  type InvoiceStatus,
} from "@/lib/rink-scheduling/ar"
import { createClient } from "@/lib/supabase/server"
import { dayKeyInTz } from "@/lib/timezone"

import { AgingTable } from "./_components/aging-table"
import { InvoiceTable } from "./_components/invoice-table"
import { NewInvoicePanel } from "./_components/new-invoice-panel"
import { NotAvailable } from "../_components/not-available"

export const dynamic = "force-dynamic"

export const metadata = { title: "Invoices | MFO / Rink Reports" }

type SearchParams = Promise<{ tab?: string; status?: string }>

type Tab = "invoices" | "aging" | "new"

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "invoices", label: "Invoices" },
  { key: "aging", label: "Aging" },
  { key: "new", label: "New invoice" },
]

function asTab(v: string | undefined): Tab {
  return (TABS.map((t) => t.key) as readonly string[]).includes(v ?? "")
    ? (v as Tab)
    : "invoices"
}

function nowDate(): Date {
  return new Date()
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()
  const supabase = await createClient()

  // AR is edit-tier: a staff or supervisor account can see the calendar but
  // never the money.
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return <NotAvailable />
  }

  const { data: profileRow } = await supabase
    .from("users")
    .select("facility_id")
    .maybeSingle()
  const facilityId = profileRow?.facility_id ?? null
  if (!facilityId) return <NotAvailable reason="no-facility" />

  const params = await searchParams
  const tab = asTab(params.tab)
  const timeZone = await getFacilityTimezone(supabase, facilityId)
  const todayKey = dayKeyInTz(nowDate(), timeZone)

  const [invoicesRes, customersRes, methodsRes] = await Promise.all([
    supabase
      .from("rink_invoices")
      .select("*")
      .eq("facility_id", facilityId)
      .order("issue_date", { ascending: false }),
    supabase
      .from("rink_customers")
      .select("id, name, is_active, default_rate_card_id")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("rink_payment_methods")
      .select("id, name")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])

  const invoices = invoicesRes.data ?? []
  const customers = customersRes.data ?? []
  const customerName = new Map(customers.map((c) => [c.id, c.name]))

  const rows = invoices.map((i) => ({
    id: i.id,
    number: i.invoice_number,
    customerName: customerName.get(i.customer_id) ?? "Customer",
    status: i.status as InvoiceStatus,
    issueDate: i.issue_date,
    dueDate: i.due_date,
    total: Number(i.total),
    amountPaid: Number(i.amount_paid),
  }))

  const aging = buildAgingReport(
    invoices.map<AgingInvoice>((i) => ({
      customerId: i.customer_id,
      customerName: customerName.get(i.customer_id) ?? "Customer",
      dueDate: i.due_date,
      totalCents: toCents(i.total),
      amountPaidCents: toCents(i.amount_paid),
      status: i.status as InvoiceStatus,
    })),
    todayKey,
  )

  const outstandingCents = aging.grandTotalCents
  const overdueCount = rows.filter(
    (r) =>
      r.status !== "draft" &&
      r.status !== "void" &&
      r.status !== "paid" &&
      r.dueDate < todayKey,
  ).length

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Invoices"
        description="Bill ice time, record payments, and see what is outstanding."
        actions={
          <Link
            href="/reports/rink-scheduling"
            className="text-muted-foreground text-sm no-underline hover:underline"
          >
            ← Calendar
          </Link>
        }
      />

      <SummaryTiles
        outstandingCents={outstandingCents}
        overdueCount={overdueCount}
        invoices={invoices}
        todayKey={todayKey}
      />

      <TabNav
        ariaLabel="Invoice sections"
        activeHref={`/reports/rink-scheduling/invoices?tab=${tab}`}
        items={TABS.map((t) => ({
          label: t.label,
          href: `/reports/rink-scheduling/invoices?tab=${t.key}`,
        }))}
      />

      {tab === "invoices" && <InvoiceTable rows={rows} todayKey={todayKey} />}
      {tab === "aging" && <AgingTable report={aging} todayKey={todayKey} />}
      {tab === "new" && (
        <NewInvoicePanel
          customers={customers}
          todayKey={todayKey}
          paymentMethods={methodsRes.data ?? []}
        />
      )}
    </div>
  )
}

/** The three numbers a facility manager checks first. */
function SummaryTiles({
  outstandingCents,
  overdueCount,
  invoices,
  todayKey,
}: {
  outstandingCents: number
  overdueCount: number
  invoices: Array<{ issue_date: string; total: number | string; amount_paid: number | string; status: string }>
  todayKey: string
}) {
  const monthPrefix = todayKey.slice(0, 7)
  const thisMonth = invoices.filter(
    (i) => i.issue_date.startsWith(monthPrefix) && i.status !== "void",
  )
  const billedCents = thisMonth.reduce((s, i) => s + toCents(i.total), 0)
  const collectedCents = thisMonth.reduce((s, i) => s + toCents(i.amount_paid), 0)

  const tiles = [
    { label: "Outstanding", value: outstandingCents, tone: "default" as const },
    { label: "Overdue invoices", count: overdueCount, tone: overdueCount > 0 ? "warn" : ("default" as const) },
    { label: "Billed this month", value: billedCents, tone: "default" as const },
    { label: "Collected this month", value: collectedCents, tone: "default" as const },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`rounded-xl border p-4 ${t.tone === "warn" ? "border-warning/40 bg-warning/10" : "bg-card"}`}
        >
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t.label}
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums">
            {"count" in t && t.count !== undefined
              ? t.count
              : `$${((t.value ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </p>
        </div>
      ))}
    </div>
  )
}
