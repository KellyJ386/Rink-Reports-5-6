import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { currentUserCan } from "@/lib/permissions/check"
import { formatMoney } from "@/lib/rink-scheduling/ar"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz, wallTimeToUtc } from "@/lib/timezone"

import { NotAvailable } from "../_components/not-available"
import {
  agingReport,
  bookingTypeMix,
  computeUtilization,
  revenueByCustomer,
  revenueByMonth,
  type InsightBooking,
  type InsightInvoice,
} from "../_lib/insights"
import { addMonthsToKey, daysInMonth, monthLabel } from "../_lib/month-model"

export const dynamic = "force-dynamic"

export const metadata = { title: "Insights | MFO / Rink Reports" }

type SearchParams = Promise<{ month?: string }>

/** Clock read outside the component body — "this month" is the FACILITY'S
 *  month, resolved from its zone, never the server's. */
function nowDate(): Date {
  return new Date()
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** "YYYY-MM" for the month `n` months away from `monthKey`. */
function shiftMonth(monthKey: string, n: number): string {
  return addMonthsToKey(`${monthKey}-01`, n).slice(0, 7)
}

/** "Mar 2026", for the revenue bars. Month keys are abstract, so UTC is the
 *  right (and deterministic) zone to format them in. */
function shortMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15, 12)))
}

function hoursLabel(minutes: number): string {
  const h = minutes / 60
  return `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`
}

function pctLabel(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(1)}%`
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireUser()
  const supabase = await createClient()

  // Insights is edit-tier, same as invoicing: it surfaces revenue and AR,
  // which a view-tier calendar account must never see.
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return <NotAvailable />
  }

  // requireUser() already resolves the caller's OWN profile row scoped by id
  // (see getCurrentUser()) — facility_id always comes from the session, never
  // from the request.
  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) return <NotAvailable reason="no-facility" />

  const params = await searchParams
  const timeZone = await getFacilityTimezone(supabase, facilityId)
  const todayKey = dayKeyInTz(nowDate(), timeZone)

  const currentMonthKey = todayKey.slice(0, 7)
  const monthKey = MONTH_RE.test(params.month ?? "")
    ? (params.month as string)
    : currentMonthKey

  const [year, month] = monthKey.split("-").map(Number)
  const fromKey = `${monthKey}-01`
  const toKey = `${monthKey}-${String(daysInMonth(year, month - 1)).padStart(2, "0")}`

  // A day of slack each side, then facility-midnight instants: fromKey/toKey
  // are facility-LOCAL day keys, and a "Z"-glued key would shift the window
  // hours early and clip evening bookings on its edge days (same construction
  // as listUninvoicedBookings). The pure fns clip back to [fromKey..toKey].
  const queryFromKey = addDaysToKey(fromKey, -1)
  const queryToKey = addDaysToKey(toKey, 1)

  const [rinksRes, hoursRes, exceptionsRes, bookingsRes, invoicesRes, customersRes, typesRes] =
    await Promise.all([
      supabase
        .from("facility_rinks")
        .select("id, name")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("facility_operating_hours")
        .select("*")
        .eq("facility_id", facilityId),
      supabase
        .from("facility_operating_hours_exceptions")
        .select("*")
        .eq("facility_id", facilityId)
        .gte("exception_date", fromKey)
        .lte("exception_date", toKey),
      supabase
        .from("rink_bookings")
        .select(
          "id, rink_id, starts_at, ends_at, status, booking_type_id, rate_snapshot_prime, computed_amount",
        )
        .eq("facility_id", facilityId)
        .gte(
          "starts_at",
          wallTimeToUtc(`${queryFromKey}T00:00`, timeZone)?.toISOString() ??
            `${queryFromKey}T00:00:00.000Z`,
        )
        .lt(
          "starts_at",
          wallTimeToUtc(`${addDaysToKey(queryToKey, 1)}T00:00`, timeZone)?.toISOString() ??
            `${queryToKey}T23:59:59.999Z`,
        )
        .order("starts_at", { ascending: true }),
      // ALL invoices: the six-month revenue trail and the aging report both
      // reach outside the selected month.
      supabase
        .from("rink_invoices")
        .select("status, issue_date, due_date, total, amount_paid, customer_id")
        .eq("facility_id", facilityId),
      // No is_active filter — an inactive customer's revenue still needs a name.
      supabase.from("rink_customers").select("id, name").eq("facility_id", facilityId),
      supabase.from("rink_booking_types").select("id, name").eq("facility_id", facilityId),
    ])

  const rinks = rinksRes.data ?? []
  const bookings: InsightBooking[] = bookingsRes.data ?? []
  const invoices: InsightInvoice[] = invoicesRes.data ?? []
  const customerName = new Map((customersRes.data ?? []).map((c) => [c.id, c.name]))
  const typeName = new Map((typesRes.data ?? []).map((t) => [t.id, t.name]))
  const rinkName = new Map(rinks.map((r) => [r.id, r.name]))

  const utilization = computeUtilization({
    bookings,
    hours: hoursRes.data ?? [],
    exceptions: exceptionsRes.data ?? [],
    rinkIds: rinks.map((r) => r.id),
    fromKey,
    toKey,
    timeZone,
  })
  const months = revenueByMonth(invoices, shiftMonth(monthKey, -5), monthKey)
  const customers = revenueByCustomer(invoices).slice(0, 8)
  const mix = bookingTypeMix(bookings, { fromKey, toKey, timeZone })
  const aging = agingReport(invoices, todayKey)

  const monthHref = (mk: string) => `/reports/rink-scheduling/insights?month=${mk}`

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Insights"
        description="Ice utilization, revenue, and receivables. Times are the rink's own local clock."
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
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm">
            <Link href={monthHref(shiftMonth(monthKey, -1))} aria-label="Previous month">
              ←
            </Link>
          </Button>
          <Button
            asChild
            variant={monthKey === currentMonthKey ? "default" : "outline"}
            size="sm"
          >
            <Link href={monthHref(currentMonthKey)}>This month</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={monthHref(shiftMonth(monthKey, 1))} aria-label="Next month">
              →
            </Link>
          </Button>
        </div>
        <span className="font-mono text-sm tabular-nums">{monthLabel(fromKey)}</span>
      </div>

      <StatRow
        utilizationPct={utilization.total.utilizationPct}
        bookedMinutes={utilization.total.bookedMinutes}
        openMinutes={utilization.total.openMinutes}
        openArCents={aging.totalOpenCents}
      />

      <UtilizationSection
        perRink={utilization.perRink}
        rinkName={rinkName}
        hasRinks={rinks.length > 0}
        hasBookings={bookings.some((b) => b.status !== "cancelled")}
      />

      <RevenueSection months={months} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopCustomersSection customers={customers} customerName={customerName} />
        <TypeMixSection mix={mix} typeName={typeName} />
      </div>

      <AgingSection aging={aging} todayKey={todayKey} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header stat row
// ---------------------------------------------------------------------------

function StatRow({
  utilizationPct,
  bookedMinutes,
  openMinutes,
  openArCents,
}: {
  utilizationPct: number | null
  bookedMinutes: number
  openMinutes: number
  openArCents: number
}) {
  const tiles = [
    { label: "Utilization", value: pctLabel(utilizationPct) },
    { label: "Booked ice", value: hoursLabel(bookedMinutes) },
    { label: "Open ice posted", value: hoursLabel(openMinutes) },
    { label: "Open A/R", value: formatMoney(openArCents / 100) },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t.label}
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums">{t.value}</p>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Utilization by rink
// ---------------------------------------------------------------------------

function UtilizationSection({
  perRink,
  rinkName,
  hasRinks,
  hasBookings,
}: {
  perRink: Array<{
    rinkId: string
    bookedMinutes: number
    primeMinutes: number
    nonPrimeMinutes: number
    unclassifiedMinutes: number
    openMinutes: number
    utilizationPct: number | null
  }>
  rinkName: Map<string, string>
  hasRinks: boolean
  hasBookings: boolean
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Utilization by rink</h2>
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <Swatch className="bg-primary" label="Prime" />
            <Swatch className="bg-primary/60" label="Non-prime" />
            <Swatch className="bg-muted-foreground/40" label="Unclassified" />
          </div>
        </div>

        {!hasRinks ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No active rinks configured for this facility.
          </p>
        ) : !hasBookings ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No bookings this month.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {perRink.map((r) => {
              // The bar caps at 100% of the posted window; the NUMBER does not
              // (booked minutes outside posted hours are real ice time).
              const barPct = r.utilizationPct === null ? 0 : Math.min(100, r.utilizationPct)
              const share = (part: number) =>
                r.bookedMinutes > 0 ? (barPct * part) / r.bookedMinutes : 0
              return (
                <div key={r.rinkId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium">
                      {rinkName.get(r.rinkId) ?? "Rink"}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs tabular-nums">
                      {hoursLabel(r.bookedMinutes)} of {hoursLabel(r.openMinutes)} ·{" "}
                      {pctLabel(r.utilizationPct)}
                    </p>
                  </div>
                  {r.openMinutes > 0 ? (
                    <div className="bg-muted flex h-3 overflow-hidden rounded-full">
                      <div className="bg-primary" style={{ width: `${share(r.primeMinutes)}%` }} />
                      <div
                        className="bg-primary/60"
                        style={{ width: `${share(r.nonPrimeMinutes)}%` }}
                      />
                      <div
                        className="bg-muted-foreground/40"
                        style={{ width: `${share(r.unclassifiedMinutes)}%` }}
                      />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      No posted operating hours this month.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Revenue, last 6 months
// ---------------------------------------------------------------------------

function RevenueSection({
  months,
}: {
  months: Array<{ monthKey: string; invoicedCents: number; collectedCents: number }>
}) {
  const max = Math.max(...months.map((m) => m.invoicedCents), 0)
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Revenue, last 6 months</h2>
        {max === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No invoices issued in this period.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {months.map((m) => (
              <div key={m.monthKey} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{shortMonthLabel(m.monthKey)}</p>
                  <p className="text-muted-foreground font-mono text-xs tabular-nums">
                    collected {formatMoney(m.collectedCents / 100)} of{" "}
                    {formatMoney(m.invoicedCents / 100)}
                  </p>
                </div>
                <div className="bg-muted relative h-3 overflow-hidden rounded-full">
                  {/* Invoiced is the pale outer bar; collected fills in over it. */}
                  <div
                    className="bg-primary/35 absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(m.invoicedCents / max) * 100}%` }}
                  />
                  <div
                    className="bg-primary absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(m.collectedCents / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Top customers
// ---------------------------------------------------------------------------

function TopCustomersSection({
  customers,
  customerName,
}: {
  customers: Array<{ customerId: string; invoicedCents: number; openCents: number }>
  customerName: Map<string, string>
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Top customers</h2>
        {customers.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No issued invoices yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {customers.map((c) => (
              <div key={c.customerId} className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm">
                  {customerName.get(c.customerId) ?? "Customer"}
                  {c.openCents > 0 && (
                    <span className="text-warning ml-2 font-mono text-xs tabular-nums">
                      {formatMoney(c.openCents / 100)} open
                    </span>
                  )}
                </p>
                <p className="shrink-0 font-mono text-sm tabular-nums">
                  {formatMoney(c.invoicedCents / 100)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Ice time by booking type
// ---------------------------------------------------------------------------

function TypeMixSection({
  mix,
  typeName,
}: {
  mix: Array<{ bookingTypeId: string; minutes: number; quotedCents: number }>
  typeName: Map<string, string>
}) {
  const max = Math.max(...mix.map((m) => m.minutes), 0)
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Ice time by booking type</h2>
        {mix.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No bookings this month.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {mix.map((m) => (
              <div key={m.bookingTypeId} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {typeName.get(m.bookingTypeId) ?? "Booking"}
                  </p>
                  <p className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                    {hoursLabel(m.minutes)} · {formatMoney(m.quotedCents / 100)}
                  </p>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-primary/60 h-full rounded-full"
                    style={{ width: `${max > 0 ? (m.minutes / max) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// A/R aging
// ---------------------------------------------------------------------------

function AgingSection({
  aging,
  todayKey,
}: {
  aging: {
    currentCents: number
    d1to30Cents: number
    d31to60Cents: number
    d61to90Cents: number
    d90PlusCents: number
    totalOpenCents: number
  }
  todayKey: string
}) {
  const cells = [
    { label: "Current", cents: aging.currentCents },
    { label: "1–30 days", cents: aging.d1to30Cents },
    { label: "31–60 days", cents: aging.d31to60Cents },
    { label: "61–90 days", cents: aging.d61to90Cents },
    { label: "90+ days", cents: aging.d90PlusCents, warn: true },
  ]
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">A/R aging</h2>
          <p className="text-muted-foreground text-sm">
            As at {todayKey}. Overdue days count from each due date.
          </p>
        </div>
        {aging.totalOpenCents === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Nothing outstanding. Every issued invoice is settled.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {cells.map((c) => (
              <div key={c.label} className="bg-background rounded-lg border p-3">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {c.label}
                </p>
                <p
                  className={`mt-1 font-mono text-sm tabular-nums ${
                    c.warn && c.cents > 0 ? "text-warning" : ""
                  }`}
                >
                  {c.cents > 0 ? formatMoney(c.cents / 100) : "—"}
                </p>
              </div>
            ))}
            <div className="bg-background rounded-lg border-2 p-3">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Total open
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {formatMoney(aging.totalOpenCents / 100)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
