import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { currentUserCan } from "@/lib/permissions/check"
import { formatMoney } from "@/lib/rink-scheduling/ar"
import { minuteToLabel } from "@/lib/rink-scheduling/booking-request"
import { isExpiringSoon } from "@/lib/rink-scheduling/season-contracts"
import { createClient } from "@/lib/supabase/server"
import { dayKeyInTz } from "@/lib/timezone"

import { NotAvailable } from "../_components/not-available"
import { ContractCard, type ContractCardView } from "./_components/contract-card"
import { CreateContractPanel } from "./_components/contract-form"

export const dynamic = "force-dynamic"

export const metadata = { title: "Season Contracts | MFO / Rink Reports" }

function nowDate(): Date {
  return new Date()
}

/** "2026-09-04" -> "Friday, September 4, 2026". Pure calendar math (UTC-noon
 *  probe formatted in UTC), the same idiom the invoice email uses — a date-only
 *  column names a facility-local calendar day, not an instant. */
function formatDayKeyLong(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  if (Number.isNaN(d.getTime())) return key
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d)
}

/** Same calendar math, compact: "2026-09-04" -> "Sep 4, 2026". */
function formatDayKeyShort(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  if (Number.isNaN(d.getTime())) return key
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d)
}

// 0 = Sunday, matching facility_operating_hours.day_of_week.
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "18:30:00" -> "6:30 PM" (facility wall clock; pure arithmetic). */
function timeOfDayLabel(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  return m ? minuteToLabel(Number(m[1]) * 60 + Number(m[2])) : t
}

function seriesSummary(s: {
  days_of_week: number[]
  start_time: string
  end_time: string
}): string {
  const days = [...s.days_of_week]
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d] ?? "?")
    .join(", ")
  return `${days} · ${timeOfDayLabel(s.start_time)} – ${timeOfDayLabel(s.end_time)}`
}

/** 1 -> "1st" … 28 -> "28th". */
function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th"
  return `${n}${suffix}`
}

export default async function ContractsPage() {
  const current = await requireUser()
  const supabase = await createClient()

  // Contracts are money: the whole page is edit-tier, same as invoicing.
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return <NotAvailable />
  }

  // requireUser() already resolves the caller's OWN profile row scoped by id
  // (see getCurrentUser()); facility comes from the session, never a param.
  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) return <NotAvailable reason="no-facility" />

  const timeZone = await getFacilityTimezone(supabase, facilityId)
  const todayKey = dayKeyInTz(nowDate(), timeZone)

  const [contractsRes, customersRes, seriesRes, invoicesRes] = await Promise.all([
    supabase
      .from("rink_season_contracts")
      .select("*")
      .eq("facility_id", facilityId)
      .order("season_end", { ascending: false }),
    // All customers for labels (a finished contract may name a deactivated
    // one); only active ones are offered in the forms.
    supabase
      .from("rink_customers")
      .select("id, name, is_active")
      .eq("facility_id", facilityId)
      .order("name", { ascending: true }),
    supabase
      .from("rink_booking_series")
      .select(
        "id, title, customer_id, contract_id, days_of_week, start_time, end_time, series_start_date, series_end_date, status",
      )
      .eq("facility_id", facilityId),
    supabase
      .from("rink_invoices")
      .select("id, invoice_number, contract_id, status, total, issue_date")
      .eq("facility_id", facilityId)
      .not("contract_id", "is", null)
      .order("issue_date", { ascending: false }),
  ])

  const contracts = contractsRes.data ?? []
  const customers = customersRes.data ?? []
  const series = seriesRes.data ?? []
  const invoices = invoicesRes.data ?? []

  const customerName = new Map(customers.map((c) => [c.id, c.name]))
  const customerOptions = customers
    .filter((c) => c.is_active)
    .map((c) => ({ id: c.id, name: c.name }))
  const renewedIds = new Set(
    contracts.map((c) => c.renewal_of).filter((v): v is string => v !== null),
  )

  const open = contracts.filter((c) => c.status === "draft" || c.status === "active")
  const finished = contracts.filter(
    (c) => c.status === "completed" || c.status === "cancelled",
  )

  const cards: ContractCardView[] = open.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status === "active" ? "active" : "draft",
    expiringSoon:
      isExpiringSoon({ status: c.status, seasonEnd: c.season_end }, todayKey) &&
      !renewedIds.has(c.id),
    customerName: customerName.get(c.customer_id) ?? "Customer",
    seasonLabel: `${formatDayKeyLong(c.season_start)} – ${formatDayKeyLong(c.season_end)}`,
    rateLabel:
      c.contract_rate !== null ? `${formatMoney(c.contract_rate)}/h` : "Card pricing",
    billingLabel: c.auto_invoice
      ? `Invoices on the ${ordinal(c.invoice_day_of_month)} · ${
          c.auto_send ? "auto-send on" : "drafts for review"
        }`
      : "Manual invoicing",
    billedThroughLabel: c.last_invoiced_period
      ? `Billed through ${c.last_invoiced_period}`
      : "Not yet billed",
    notes: c.notes,
    customerId: c.customer_id,
    seasonStart: c.season_start,
    seasonEnd: c.season_end,
    contractRate: c.contract_rate === null ? null : Number(c.contract_rate),
    autoInvoice: c.auto_invoice,
    autoSend: c.auto_send,
    invoiceDayOfMonth: c.invoice_day_of_month,
    boundSeries: series
      .filter((s) => s.contract_id === c.id)
      .map((s) => ({ id: s.id, title: s.title, summary: seriesSummary(s) })),
    bindOptions: series
      .filter(
        (s) =>
          s.contract_id === null &&
          s.customer_id === c.customer_id &&
          s.status !== "cancelled",
      )
      .map((s) => ({
        id: s.id,
        label: s.title ? `${s.title} — ${seriesSummary(s)}` : seriesSummary(s),
      })),
    invoices: invoices
      .filter((i) => i.contract_id === c.id)
      .map((i) => ({
        id: i.id,
        number: i.invoice_number,
        issueDate: formatDayKeyShort(i.issue_date),
        totalLabel: formatMoney(i.total),
        status: i.status,
      })),
  }))

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Season Contracts"
        description="Season agreements with clubs — bound series, negotiated rates, and monthly invoicing."
        actions={
          <>
            <Link
              href="/reports/rink-scheduling"
              className="text-muted-foreground text-sm no-underline hover:underline"
            >
              ← Calendar
            </Link>
            <Link
              href="/reports/rink-scheduling/invoices"
              className="text-muted-foreground text-sm no-underline hover:underline"
            >
              Invoices →
            </Link>
            <Link
              href="/reports/rink-scheduling/insights"
              className="text-muted-foreground text-sm no-underline hover:underline"
            >
              Insights →
            </Link>
            <Link
              href="/reports/rink-scheduling/requests"
              className="text-muted-foreground text-sm no-underline hover:underline"
            >
              Requests →
            </Link>
          </>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight">
          Active & draft contracts
        </h2>
        {cards.length === 0 ? (
          <EmptyState
            title="No contracts yet"
            description="Create a season contract below to bind a club's recurring ice and bill it month by month."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {cards.map((c) => (
              <ContractCard key={c.id} contract={c} customers={customerOptions} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Create contract</h2>
        <CreateContractPanel customers={customerOptions} />
      </section>

      {finished.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Finished</h2>
          <div className="overflow-hidden rounded-xl border">
            <ul className="divide-border divide-y">
              {finished.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      <Badge variant={c.status === "completed" ? "outline" : "neutral"}>
                        {c.status}
                      </Badge>{" "}
                      <span className="font-medium">{c.name}</span>{" "}
                      <span className="text-muted-foreground">
                        — {customerName.get(c.customer_id) ?? "Customer"},{" "}
                        {formatDayKeyShort(c.season_start)} –{" "}
                        {formatDayKeyShort(c.season_end)}
                      </span>
                    </p>
                    {c.cancel_reason ? (
                      <p className="text-muted-foreground text-xs">{c.cancel_reason}</p>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {c.last_invoiced_period
                      ? `Billed through ${c.last_invoiced_period}`
                      : "Never billed"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
