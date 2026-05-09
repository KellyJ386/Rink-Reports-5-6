import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { DropdownsTab } from "./_components/dropdowns-tab"
import { HistoryTabLoader } from "./_components/history-tab"
import { SeedDefaultsCard } from "./_components/seed-defaults-card"
import { WorkersCompTab } from "./_components/workers-comp-tab"
import {
  DROPDOWN_CATEGORIES,
  TABS,
  isDropdownCategory,
  type AccidentDropdownRow,
  type DropdownCategory,
  type Tab,
} from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  category?: string
  report?: string
  from?: string
  to?: string
  employee?: string
  severity?: string
  body_part?: string
  location?: string
  activity?: string
  medical_attention?: string
  wc?: string
}>

function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "history"
}

function tabHref(tab: Tab): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  return `/admin/accident-reports?${sp.toString()}`
}

export const metadata = { title: "Accident Reports | MFO / Rink Reports" }

export default async function AccidentReportsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const params = await searchParams
  const tab = asTab(params.tab)
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before reviewing accident reports.
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
      <TabBar active={tab} />

      {tab === "history" && (
        <HistoryTabLoader facilityId={facilityId} params={params} />
      )}

      {tab === "dropdowns" && (
        <DropdownsTabLoader
          facilityId={facilityId}
          rawCategory={params.category}
        />
      )}

      {tab === "workers-comp" && (
        <WorkersCompTabLoader facilityId={facilityId} />
      )}
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Accident Reports Admin
      </h1>
      <p className="text-muted-foreground text-sm">
        Review submitted accident reports, manage dropdown values, and edit
        Workers&apos; Compensation instructions. Original reports are immutable.
      </p>
    </div>
  )
}

function TabBar({ active }: { active: Tab }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-md border p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={tabHref(t.key)}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            active === t.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Per-tab loaders (server components)
// ---------------------------------------------------------------------------

async function DropdownsTabLoader({
  facilityId,
  rawCategory,
}: {
  facilityId: string
  rawCategory: string | undefined
}) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("accident_dropdowns")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true })

  const all = (data ?? []) as AccidentDropdownRow[]

  if (all.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SeedDefaultsCard />
      </div>
    )
  }

  const category: DropdownCategory =
    rawCategory && isDropdownCategory(rawCategory)
      ? rawCategory
      : "injury_type"

  const counts = DROPDOWN_CATEGORIES.reduce(
    (acc, c) => {
      acc[c] = 0
      return acc
    },
    {} as Record<DropdownCategory, number>,
  )
  for (const row of all) {
    if (isDropdownCategory(row.category)) {
      counts[row.category] = (counts[row.category] ?? 0) + 1
    }
  }

  const rows = all.filter((r) => r.category === category)

  return (
    <DropdownsTab
      category={category}
      rows={rows}
      totalCount={all.length}
      countsByCategory={counts}
    />
  )
}

async function WorkersCompTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("accident_workers_comp_settings")
    .select("id, instructions, updated_at, created_at")
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <WorkersCompTab
      instructions={data?.instructions ?? ""}
      updatedAt={data?.updated_at ?? data?.created_at ?? null}
      hasRow={Boolean(data?.id)}
    />
  )
}
