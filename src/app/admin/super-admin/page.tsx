import { redirect } from "next/navigation"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { FacilitiesPanel } from "./_components/facilities-panel"
import { InviteServiceHealthCard } from "./_components/invite-service-health-card"
import { SuperAdminUsersPanel } from "./_components/super-admin-users-panel"
import type { FacilityRow, FacilityWithStats, SuperAdminUserRow } from "./types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Super Admin | MFO / Rink Reports" }

const PAGE_SIZE = 50

type SearchParams = Promise<{ page?: string }>

export default async function SuperAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()

  if (!current.profile?.is_super_admin) {
    redirect("/forbidden")
  }

  const currentUserId = current.profile.id

  const { page: pageParam } = await searchParams
  const parsedPage = Number.parseInt(pageParam ?? "1", 10)
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1
  const fromRow = (page - 1) * PAGE_SIZE
  const toRow = fromRow + PAGE_SIZE - 1

  const supabase = await createClient()

  // Load the paginated facilities page (heavy display rows), the single
  // aggregate employee-counts RPC, a lightweight all-facilities lookup (for
  // stats + resolving facility names in the users panel — a user can belong to
  // a facility that isn't on the current page), and users — all in parallel.
  const [facilitiesRes, empCountsRes, facilityLookupRes, usersRes] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("id, name, slug, timezone, is_active, created_at", {
          count: "exact",
        })
        .order("name", { ascending: true })
        .range(fromRow, toRow),
      supabase.rpc("get_employee_counts_by_facility"),
      supabase.from("facilities").select("id, name, is_active"),
      supabase
        .from("users")
        .select(
          "id, email, full_name, is_super_admin, is_active, last_seen_at, created_at, facility_id",
        )
        .order("full_name", { ascending: true, nullsFirst: false })
        .order("email", { ascending: true }),
    ])

  const facilities = (facilitiesRes.data ?? []) as FacilityRow[]
  const totalFacilitiesCount = facilitiesRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalFacilitiesCount / PAGE_SIZE))
  // Clamp for display math if the URL requested a page past the end.
  const currentPage = Math.min(page, totalPages)

  const empCounts = (empCountsRes.data ?? []) as Array<{
    facility_id: string
    employee_count: number
  }>
  const empCountMap = new Map(empCounts.map((r) => [r.facility_id, r.employee_count]))

  const facilitiesWithStats: FacilityWithStats[] = facilities.map((f) => ({
    ...f,
    employee_count: empCountMap.get(f.id) ?? 0,
  }))

  // Lightweight all-facilities lookup: drives stats + the users-panel name map.
  const facilityLookup = (facilityLookupRes.data ?? []) as Array<{
    id: string
    name: string
    is_active: boolean
  }>
  const facilityNameMap = new Map(facilityLookup.map((f) => [f.id, f.name]))

  const rawUsers = (usersRes.data ?? []) as Array<{
    id: string
    email: string
    full_name: string | null
    is_super_admin: boolean
    is_active: boolean
    last_seen_at: string | null
    created_at: string
    facility_id: string | null
  }>

  const users: SuperAdminUserRow[] = rawUsers.map((u) => ({
    ...u,
    facility_name: u.facility_id ? (facilityNameMap.get(u.facility_id) ?? null) : null,
  }))

  const totalFacilities = totalFacilitiesCount
  const activeFacilities = facilityLookup.filter((f) => f.is_active).length
  const totalUsers = users.length
  const superAdminCount = users.filter((u) => u.is_super_admin).length

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
        <p className="text-muted-foreground text-sm">
          Cross-facility platform management. Changes here affect all tenants.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total facilities" value={totalFacilities} />
        <StatCard label="Active facilities" value={activeFacilities} />
        <StatCard label="Total users" value={totalUsers} />
        <StatCard label="Super admins" value={superAdminCount} />
      </div>

      <FacilitiesPanel
        facilities={facilitiesWithStats}
        page={currentPage}
        totalPages={totalPages}
        totalCount={totalFacilitiesCount}
        pageSize={PAGE_SIZE}
      />
      <SuperAdminUsersPanel users={users} currentUserId={currentUserId} />
      <InviteServiceHealthCard />
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-4 flex flex-col gap-1">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
