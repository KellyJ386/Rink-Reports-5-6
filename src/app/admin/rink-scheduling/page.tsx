import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { requireAdmin, requireModuleAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { DisplaysTab } from "./_components/displays-tab"
import type { DisplayTokenView } from "./_components/displays-tab"
import { FacilitySetupTab } from "./_components/facility-setup-tab"
import { ListsTab } from "./_components/lists-tab"
import { RateCardsTab } from "./_components/rate-cards-tab"
import { SettingsTab } from "./_components/settings-tab"
import type {
  BookingTypeRow,
  CustomerTypeRow,
  DisplayTokenRow,
  HoursExceptionRow,
  LockerRoomRow,
  OperatingHoursRow,
  PaymentMethodRow,
  RateCardRow,
  RateCardTypeOverrideRow,
  RateCardWindowRow,
  RinkRow,
  SettingsRow,
} from "./types"
import { asTab, consoleNavItems, tabHref } from "./types"
import { describeLastSeen } from "./_lib/config"

export const dynamic = "force-dynamic"

export const metadata = { title: "Rink Scheduling | MFO / Rink Reports" }

type SearchParams = Promise<{ tab?: string }>

/** Read the clock outside the component body, matching the `defaultDateFrom`
 *  precedent in the ice-operations admin page: relative ages must be resolved
 *  server-side (see DisplaysLoader), and React's purity rule flags a direct
 *  clock read during render. */
function currentTimeMs(): number {
  return Date.now()
}

export default async function RinkSchedulingAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  // Console access alone is not enough. Every write on this page is RLS-gated
  // on the module-scoped rink_scheduling grant, and an RLS-filtered UPDATE
  // returns zero rows WITHOUT raising — so a user holding the console but not
  // the module would watch every save appear to succeed and change nothing.
  // Same reasoning as ice-operations / incident-reports.
  await requireModuleAdmin("rink_scheduling")

  const params = await searchParams
  const tab = asTab(params.tab)
  const facilityId = current.profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before setting up rink scheduling.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <TabNav
        ariaLabel="Rink scheduling sections"
        activeHref={tabHref(tab)}
        items={consoleNavItems()}
      />

      {tab === "setup" && <FacilitySetupLoader facilityId={facilityId} />}
      {tab === "rates" && <RateCardsLoader facilityId={facilityId} />}
      {tab === "lists" && <ListsLoader facilityId={facilityId} />}
      {tab === "displays" && <DisplaysLoader facilityId={facilityId} />}
      {tab === "settings" && <SettingsLoader facilityId={facilityId} />}
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Rink Scheduling & Billing"
      description="Set up the facility — rinks, locker rooms and operating hours — then the rates, lists and lobby displays that everything else reads from. A new facility is fully configurable here with no code changes."
    />
  )
}

// ---------------------------------------------------------------------------
// Facility Setup — the root of the module. Everything downstream (calendar
// columns, locker room pickers, the TV display, coverage checks) reads from
// these four tables and only these four.
// ---------------------------------------------------------------------------

async function FacilitySetupLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [rinksRes, roomsRes, hoursRes, exceptionsRes] = await Promise.all([
    supabase
      .from("facility_rinks")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("facility_locker_rooms")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("facility_operating_hours")
      .select("*")
      .eq("facility_id", facilityId)
      .order("day_of_week", { ascending: true }),
    supabase
      .from("facility_operating_hours_exceptions")
      .select("*")
      .eq("facility_id", facilityId)
      .order("exception_date", { ascending: true }),
  ])

  return (
    <FacilitySetupTab
      rinks={(rinksRes.data ?? []) as RinkRow[]}
      lockerRooms={(roomsRes.data ?? []) as LockerRoomRow[]}
      hours={(hoursRes.data ?? []) as OperatingHoursRow[]}
      exceptions={(exceptionsRes.data ?? []) as HoursExceptionRow[]}
    />
  )
}

async function RateCardsLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [cardsRes, windowsRes, overridesRes, typesRes] = await Promise.all([
    supabase
      .from("rink_rate_cards")
      .select("*")
      .eq("facility_id", facilityId)
      .order("effective_start", { ascending: false }),
    supabase
      .from("rink_rate_card_windows")
      .select("*")
      .eq("facility_id", facilityId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true }),
    supabase
      .from("rink_rate_card_type_overrides")
      .select("*")
      .eq("facility_id", facilityId),
    supabase
      .from("rink_booking_types")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
  ])

  return (
    <RateCardsTab
      cards={(cardsRes.data ?? []) as RateCardRow[]}
      windows={(windowsRes.data ?? []) as RateCardWindowRow[]}
      overrides={(overridesRes.data ?? []) as RateCardTypeOverrideRow[]}
      bookingTypes={(typesRes.data ?? []) as BookingTypeRow[]}
    />
  )
}

async function ListsLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [bookingTypesRes, customerTypesRes, paymentMethodsRes] = await Promise.all([
    supabase
      .from("rink_booking_types")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("rink_customer_types")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("rink_payment_methods")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
  ])

  return (
    <ListsTab
      bookingTypes={(bookingTypesRes.data ?? []) as BookingTypeRow[]}
      customerTypes={(customerTypesRes.data ?? []) as CustomerTypeRow[]}
      paymentMethods={(paymentMethodsRes.data ?? []) as PaymentMethodRow[]}
    />
  )
}

async function DisplaysLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  // token_hash is deliberately NOT selected: nothing downstream needs it, and
  // not shipping it to the client keeps it out of the RSC payload.
  const { data } = await supabase
    .from("rink_display_tokens")
    .select(
      "id, facility_id, label, display_type, settings, is_active, last_seen_at, revoked_at, created_at, updated_at, created_by",
    )
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })

  const { data: settings } = await supabase
    .from("rink_scheduling_settings")
    .select("display_refresh_seconds")
    .eq("facility_id", facilityId)
    .maybeSingle()

  // Relative ages are resolved here, on the server, for two reasons: React's
  // purity rule forbids reading the clock during a client render, and a
  // browser-side computation would disagree with this markup whenever the two
  // clocks differ, producing a hydration mismatch on every row.
  const nowMs = currentTimeMs()
  const tokens: DisplayTokenView[] = (
    (data ?? []) as Omit<DisplayTokenRow, "token_hash">[]
  ).map((t) => ({
    ...t,
    lastSeenLabel: describeLastSeen(
      t.last_seen_at,
      nowMs,
      !t.is_active || t.revoked_at !== null,
    ),
  }))

  return (
    <DisplaysTab
      tokens={tokens}
      defaultRefreshSeconds={settings?.display_refresh_seconds ?? 60}
    />
  )
}

async function SettingsLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  // select("*") is deliberate: the form posts back every column, so an omitted
  // one here would silently revert that setting to its default on save.
  const { data } = await supabase
    .from("rink_scheduling_settings")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle()

  return <SettingsTab settings={(data ?? null) as SettingsRow | null} />
}
