import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { requireAdmin, requireModuleAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { ChecklistTab } from "./_components/checklist-tab"
import { ListsTab } from "./_components/lists-tab"
import { PerimeterTab } from "./_components/perimeter-tab"
import { RinkSettingsCard } from "./_components/rink-settings-card"
import type {
  AssetRow,
  ChecklistItemRow,
  IssueCategoryRow,
  RinkRow,
  SubtypeRow,
  Tab,
} from "./types"
import { TABS, asTab } from "./types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dasher Boards | MFO / Rink Reports" }

type SearchParams = Promise<{ tab?: string; rink?: string }>

function tabHref(tab: Tab, rinkId?: string): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  if (rinkId) sp.set("rink", rinkId)
  return `/admin/dasher-boards?${sp.toString()}`
}

export default async function DasherBoardsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  // Console access alone is not enough: every write in this module is
  // RLS-gated on the module-scoped dasher_boards/admin grant, and RLS-filtered
  // updates fail silently (zero rows). Same pattern as ice-operations.
  await requireModuleAdmin("dasher_boards")
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
              Create a facility before configuring dasher boards.
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

  const supabase = await createClient()
  const { data: rinksData } = await supabase
    .from("dasher_boards_rinks")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  const rinks = (rinksData ?? []) as RinkRow[]

  // Wizard step 1: no rink configured yet.
  if (rinks.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>Set up your first rink</CardTitle>
            <CardDescription>
              The entire perimeter is generated from what you enter here —
              nothing about panel counts, doors, or positions is hardcoded.
              Start with the rink basics; the sequence builder comes next.
            </CardDescription>
          </CardHeader>
        </Card>
        <RinkSettingsCard mode="create" />
      </div>
    )
  }

  const selectedRink =
    rinks.find((r) => r.id === params.rink) ??
    rinks.find((r) => r.is_default) ??
    rinks[0]

  const [assetsRes, subtypesRes, categoriesRes, itemsRes] = await Promise.all([
    supabase
      .from("dasher_boards_assets")
      .select("*")
      .eq("rink_id", selectedRink.id)
      .order("sequence_position", { ascending: true, nullsFirst: false })
      .order("label", { ascending: true }),
    supabase
      .from("dasher_boards_asset_subtypes")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("dasher_boards_issue_categories")
      .select("*")
      .eq("facility_id", facilityId)
      .order("asset_type", { ascending: true })
      .order("sort_order", { ascending: true }),
    supabase
      .from("dasher_boards_checklist_items")
      .select("*")
      .eq("rink_id", selectedRink.id)
      .order("sort_order", { ascending: true }),
  ])

  const assets = (assetsRes.data ?? []) as AssetRow[]
  const subtypes = (subtypesRes.data ?? []) as SubtypeRow[]
  const categories = (categoriesRes.data ?? []) as IssueCategoryRow[]
  const items = (itemsRes.data ?? []) as ChecklistItemRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      {rinks.length > 1 && (
        <TabNav
          ariaLabel="Rink"
          items={rinks.map((r) => ({
            label: r.name,
            href: tabHref(tab, r.id),
          }))}
          activeHref={tabHref(tab, selectedRink.id)}
        />
      )}
      <TabNav
        ariaLabel="Dasher Boards admin sections"
        items={TABS.map((t) => ({
          label: t.label,
          href: tabHref(t.key, rinks.length > 1 ? selectedRink.id : undefined),
        }))}
        activeHref={tabHref(tab, rinks.length > 1 ? selectedRink.id : undefined)}
      />

      {tab === "perimeter" && (
        <PerimeterTab
          rink={selectedRink}
          assets={assets}
          doorSubtypes={subtypes.filter(
            (s) => s.asset_type === "door" && s.is_active,
          )}
        />
      )}
      {tab === "checklist" && <ChecklistTab rink={selectedRink} items={items} />}
      {tab === "lists" && (
        <ListsTab subtypes={subtypes} categories={categories} />
      )}
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Dasher Boards"
      description="Spatial perimeter condition tracking. Configure the rink's board/glass/door sequence, cadenced checklist items, door subtypes, and issue categories. Labels are permanent identity — the editor never renumbers existing assets."
    />
  )
}
