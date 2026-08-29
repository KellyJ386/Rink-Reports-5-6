import Link from "next/link"

import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { currentUserCan } from "@/lib/permissions/check"
import { minuteToLabel } from "@/lib/rink-scheduling/booking-request"
import { createClient } from "@/lib/supabase/server"
import { dayKeyInTz, formatInTz } from "@/lib/timezone"

import { NotAvailable } from "../_components/not-available"
import {
  RequestInbox,
  type DecidedRequestView,
  type NewRequestView,
} from "./_components/request-inbox"
import { WaitlistPanel, type WaitlistEntryView } from "./_components/waitlist-panel"

export const dynamic = "force-dynamic"

export const metadata = { title: "Requests & Waitlist | MFO / Rink Reports" }

type SearchParams = Promise<{ tab?: string }>

type Tab = "requests" | "waitlist"

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "requests", label: "Requests" },
  { key: "waitlist", label: "Waitlist" },
]

function asTab(v: string | undefined): Tab {
  return (TABS.map((t) => t.key) as readonly string[]).includes(v ?? "")
    ? (v as Tab)
    : "requests"
}

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

/** "5:30 PM – 1:00 AM (past midnight)" from stored minutes. */
function windowLabel(startMinute: number, endMinute: number): string {
  const base = `${minuteToLabel(startMinute)} – ${minuteToLabel(endMinute)}`
  return endMinute >= 1440 ? `${base} (past midnight)` : base
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireUser()
  const supabase = await createClient()

  // The whole page is edit-tier: the two tables' RLS grants SELECT only to
  // edit-tier accounts, so a view-tier scheduler would just see empty lists.
  // Gate up front and explain instead.
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return <NotAvailable />
  }

  // requireUser() already resolves the caller's OWN profile row scoped by id
  // (see getCurrentUser()); facility comes from the session, never a param.
  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) return <NotAvailable reason="no-facility" />

  const params = await searchParams
  const tab = asTab(params.tab)
  const timeZone = await getFacilityTimezone(supabase, facilityId)
  const todayKey = dayKeyInTz(nowDate(), timeZone)

  const [newRes, decidedRes, waitlistRes, customersRes, rinksRes] =
    await Promise.all([
      supabase
        .from("rink_booking_requests")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("status", "new")
        .order("requested_date", { ascending: true })
        .order("start_minute", { ascending: true }),
      supabase
        .from("rink_booking_requests")
        .select("*")
        .eq("facility_id", facilityId)
        .in("status", ["approved", "declined"])
        .order("decided_at", { ascending: false })
        .limit(20),
      supabase
        .from("rink_waitlist_entries")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("status", "open")
        .order("desired_date", { ascending: true }),
      supabase
        .from("rink_customers")
        .select("id, name")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("facility_rinks")
        .select("id, name")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ])

  const rinks = rinksRes.data ?? []
  const customers = customersRes.data ?? []
  const rinkName = new Map(rinks.map((r) => [r.id, r.name]))
  const customerName = new Map(customers.map((c) => [c.id, c.name]))

  const inbox: NewRequestView[] = (newRes.data ?? []).map((r) => ({
    id: r.id,
    requesterName: r.requester_name,
    requesterEmail: r.requester_email,
    requesterPhone: r.requester_phone,
    organization: r.organization,
    dateLong: formatDayKeyLong(r.requested_date),
    timeLabel: windowLabel(r.start_minute, r.end_minute),
    rinkId: r.rink_id,
    rinkName: r.rink_id ? (rinkName.get(r.rink_id) ?? "Rink") : null,
    purpose: r.purpose,
    receivedAt: formatInTz(r.created_at, timeZone),
  }))

  const decided: DecidedRequestView[] = (decidedRes.data ?? []).map((r) => ({
    id: r.id,
    requesterName: r.requester_name,
    organization: r.organization,
    status: r.status === "approved" ? "approved" : "declined",
    dateLong: formatDayKeyLong(r.requested_date),
    timeLabel: windowLabel(r.start_minute, r.end_minute),
    rinkName: r.rink_id ? (rinkName.get(r.rink_id) ?? "Rink") : null,
    decidedAt: r.decided_at ? formatInTz(r.decided_at, timeZone) : "—",
    decisionNote: r.decision_note,
  }))

  const waitlist: WaitlistEntryView[] = (waitlistRes.data ?? []).map((w) => ({
    id: w.id,
    who:
      (w.customer_id ? customerName.get(w.customer_id) : null) ??
      w.contact_name ??
      "Customer",
    phone: w.contact_phone,
    dateLong: formatDayKeyLong(w.desired_date),
    windowLabel:
      w.start_minute !== null && w.end_minute !== null
        ? windowLabel(w.start_minute, w.end_minute)
        : "Any time",
    rinkName: w.rink_id ? (rinkName.get(w.rink_id) ?? "Rink") : null,
    notes: w.notes,
  }))

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Requests & Waitlist"
        description="Ice-time requests from the public form, and who to call when a slot frees up."
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
              href="/reports/rink-scheduling/contracts"
              className="text-muted-foreground text-sm no-underline hover:underline"
            >
              Contracts →
            </Link>
          </>
        }
      />

      <TabNav
        ariaLabel="Requests sections"
        activeHref={`/reports/rink-scheduling/requests?tab=${tab}`}
        items={TABS.map((t) => ({
          label:
            t.key === "requests" && inbox.length > 0
              ? `${t.label} (${inbox.length})`
              : t.label,
          href: `/reports/rink-scheduling/requests?tab=${t.key}`,
        }))}
      />

      {tab === "requests" && <RequestInbox inbox={inbox} decided={decided} rinks={rinks} />}
      {tab === "waitlist" && (
        <WaitlistPanel
          entries={waitlist}
          customers={customers}
          rinks={rinks}
          todayKey={todayKey}
        />
      )}
    </div>
  )
}
