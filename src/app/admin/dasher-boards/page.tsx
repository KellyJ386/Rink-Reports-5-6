import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/admin/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { requireAdmin, requireModuleAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { resolveRinkGlassNumbers } from "@/app/reports/dasher-boards/_lib/queries"

import { ChecklistTab } from "./_components/checklist-tab"
import { ListsTab } from "./_components/lists-tab"
import { PerimeterTab } from "./_components/perimeter-tab"
import { RinkSettingsCard } from "./_components/rink-settings-card"
import { WalksTab } from "./_components/walks-tab"
import type {
  AssetCheckRow,
  AssetRow,
  ChecklistItemRow,
  EmployeeLite,
  InspectionRow,
  IssueCategoryRow,
  RinkRow,
  SubtypeRow,
  Tab,
  WalkAssetCheckItem,
  WalkDetailData,
  WalkListItem,
} from "./types"
import { TABS, asTab } from "./types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dasher Boards | MFO / Rink Reports" }

type SearchParams = Promise<{ tab?: string; rink?: string; walk?: string }>

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

      {/* Keyed by rink so switching rinks remounts every form with fresh
          defaults (uncontrolled inputs otherwise show the previous rink). */}
      {tab === "perimeter" && (
        <PerimeterTab
          key={selectedRink.id}
          rink={selectedRink}
          assets={assets}
          doorSubtypes={subtypes.filter(
            (s) => s.asset_type === "door" && s.is_active,
          )}
        />
      )}
      {tab === "checklist" && (
        <ChecklistTab key={selectedRink.id} rink={selectedRink} items={items} />
      )}
      {tab === "lists" && (
        <ListsTab subtypes={subtypes} categories={categories} />
      )}
      {tab === "walks" && (
        <WalksTabLoader
          key={selectedRink.id}
          facilityId={facilityId}
          rinkId={selectedRink.id}
          walkId={params.walk}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Walks tab — read-only history of completed/in-progress inspection walks.
// Loaded only when the tab is active (unlike the shared perimeter/checklist
// data above, which every tab pays for today); mirrors the list-then-drilldown
// loader pattern used by HistoryTabLoader in the Ice Depth admin console.
// ---------------------------------------------------------------------------

async function WalksTabLoader({
  facilityId,
  rinkId,
  walkId,
}: {
  facilityId: string
  rinkId: string
  walkId?: string
}) {
  const supabase = await createClient()

  const [inspectionsRes, facilityRes] = await Promise.all([
    supabase
      .from("dasher_boards_inspections")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("rink_id", rinkId)
      .order("started_at", { ascending: false }),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle(),
  ])

  const inspections = (inspectionsRes.data ?? []) as InspectionRow[]
  const timezone = facilityRes.data?.timezone ?? null

  const tally = new Map<string, { fail: number; total: number }>()
  if (inspections.length > 0) {
    // Asset checks for exactly this rink's walks, so fail counts can be
    // tallied without a per-row query.
    const { data: checkRows } = await supabase
      .from("dasher_boards_asset_checks")
      .select("inspection_id, status")
      .eq("facility_id", facilityId)
      .in(
        "inspection_id",
        inspections.map((i) => i.id),
      )
    for (const row of (checkRows ?? []) as Array<
      Pick<AssetCheckRow, "inspection_id" | "status">
    >) {
      const cur = tally.get(row.inspection_id) ?? { fail: 0, total: 0 }
      cur.total += 1
      if (row.status === "fail") cur.fail += 1
      tally.set(row.inspection_id, cur)
    }
  }

  const inspectorIds = Array.from(
    new Set(
      inspections
        .map((i) => i.inspector_id)
        .filter((v): v is string => !!v),
    ),
  )
  let inspectors: EmployeeLite[] = []
  if (inspectorIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", inspectorIds)
    inspectors = (data ?? []) as EmployeeLite[]
  }
  const inspectorById = new Map(inspectors.map((e) => [e.id, e]))

  const list: WalkListItem[] = inspections.map((i) => ({
    ...i,
    inspector: i.inspector_id
      ? (inspectorById.get(i.inspector_id) ?? null)
      : null,
    failCount: tally.get(i.id)?.fail ?? 0,
    checkCount: tally.get(i.id)?.total ?? 0,
  }))

  const backHref = `/admin/dasher-boards?tab=walks&rink=${rinkId}`

  let detail: WalkDetailData | null = null
  if (walkId) {
    const inspection = inspections.find((i) => i.id === walkId) ?? null
    if (inspection) {
      const { data: checkRows } = await supabase
        .from("dasher_boards_asset_checks")
        .select("*")
        .eq("inspection_id", inspection.id)

      const checks = (checkRows ?? []) as AssetCheckRow[]

      const assetIds = Array.from(new Set(checks.map((c) => c.asset_id)))
      const checkedByIds = Array.from(
        new Set(
          checks.map((c) => c.checked_by).filter((v): v is string => !!v),
        ),
      )

      const [assetsRes, checkedByRes] = await Promise.all([
        assetIds.length > 0
          ? supabase
              .from("dasher_boards_assets")
              .select("id, label, asset_type")
              .in("id", assetIds)
          : Promise.resolve({ data: [] }),
        checkedByIds.length > 0
          ? supabase
              .from("employees")
              .select("id, first_name, last_name")
              .in("id", checkedByIds)
          : Promise.resolve({ data: [] }),
      ])

      const assetById = new Map(
        (
          (assetsRes.data ?? []) as Array<
            Pick<AssetRow, "id" | "label" | "asset_type">
          >
        ).map((a) => [a.id, a]),
      )
      const checkedByEmp = (checkedByRes.data ?? []) as EmployeeLite[]
      const checkedById = new Map(checkedByEmp.map((e) => [e.id, e]))

      const items: WalkAssetCheckItem[] = checks.map((c) => ({
        ...c,
        asset: assetById.get(c.asset_id) ?? null,
        checkedBy: c.checked_by ? (checkedById.get(c.checked_by) ?? null) : null,
      }))

      // The rink's glass numbers, so a walk reads in the numbering the crew
      // used on the floor. Needs the WHOLE perimeter (numbering is positional),
      // not just the checked assets.
      const [{ data: rinkRow }, { data: perimeterAssets }] = await Promise.all([
        supabase
          .from("dasher_boards_rinks")
          .select("*")
          .eq("id", inspection.rink_id)
          .maybeSingle(),
        supabase
          .from("dasher_boards_assets")
          .select(
            "id, asset_type, is_active, sequence_position, parent_board_id, display_number",
          )
          .eq("rink_id", inspection.rink_id),
      ])
      const glassNumbers = rinkRow
        ? resolveRinkGlassNumbers(rinkRow, perimeterAssets ?? [])
        : {}

      // Fails first (what needs attention); within each group, natural sort
      // by asset label (B2 before B12) so the order matches the perimeter walk.
      items.sort((a, b) => {
        if (a.status !== b.status) return a.status === "fail" ? -1 : 1
        const la = a.asset?.label ?? ""
        const lb = b.asset?.label ?? ""
        return la.localeCompare(lb, undefined, { numeric: true })
      })

      detail = {
        inspection,
        inspector: inspection.inspector_id
          ? (inspectorById.get(inspection.inspector_id) ?? null)
          : null,
        checks: items,
        glassNumbers,
      }
    }
  }

  return (
    <WalksTab
      list={list}
      detail={detail}
      backHref={backHref}
      rinkId={rinkId}
      timezone={timezone}
    />
  )
}

function Header() {
  return (
    <PageHeader
      title="Dasher Boards"
      description="Spatial perimeter condition tracking. Configure the rink's board/glass/door sequence, cadenced checklist items, door subtypes, and issue categories. Labels are permanent identity — the editor never renumbers existing assets."
      actions={<ExportButton moduleKey="dasher_boards" />}
    />
  )
}
