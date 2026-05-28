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
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { EditFacilitySection } from "./_components/edit-facility-section"
import { FacilitiesTable } from "./_components/facilities-table"
import { NewFacilityButton } from "./_components/new-facility-button"
import { ReadOnlyFacilityView } from "./_components/read-only-view"
import type {
  FacilityCounts,
  FacilityListItem,
  FacilityRow,
} from "./types"

export const dynamic = "force-dynamic"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function pickIdParam(
  raw: string | string[] | undefined
): string | null {
  if (!raw) return null
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  return UUID_PATTERN.test(value) ? value : null
}

const FACILITY_COLUMNS =
  "id, name, slug, timezone, settings, is_active, created_at, updated_at, address, city, state, zip_code, phone, email"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function loadAllFacilities(
  supabase: SupabaseClient
): Promise<FacilityListItem[]> {
  const { data, error } = await supabase
    .from("facilities")
    .select(FACILITY_COLUMNS)
    .order("created_at", { ascending: true })

  if (error || !data) return []

  const rows = data as FacilityRow[]
  if (rows.length === 0) return []

  // Fetch all employee counts in a single aggregation query instead of
  // issuing one COUNT per facility (N+1 pattern).
  const { data: countRows } = await supabase.rpc("get_employee_counts_by_facility")
  const countMap = new Map(
    (countRows ?? []).map(
      (r: { facility_id: string; employee_count: number }) => [
        r.facility_id,
        r.employee_count,
      ]
    )
  )

  return rows.map((row) => ({
    ...row,
    employee_count: countMap.get(row.id) ?? 0,
  }))
}

async function loadFacilityById(
  supabase: SupabaseClient,
  id: string
): Promise<FacilityRow | null> {
  const { data, error } = await supabase
    .from("facilities")
    .select(FACILITY_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null
  return data as FacilityRow
}

async function loadFacilityCounts(
  supabase: SupabaseClient,
  facilityId: string
): Promise<FacilityCounts> {
  const [employees, departments, roles] = await Promise.all([
    supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId),
    supabase
      .from("departments")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId),
    supabase
      .from("roles")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId),
  ])

  return {
    employees: employees.count ?? 0,
    departments: departments.count ?? 0,
    roles: roles.count ?? 0,
  }
}


function NotSignedIn() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Facility Settings" />
      <Card>
        <CardHeader>
          <CardTitle>Sign in required</CardTitle>
          <CardDescription>
            You need to be signed in to view facility settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function NoFacilityAssigned() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Facility Settings" />
      <Card>
        <CardHeader>
          <CardTitle>No facility yet</CardTitle>
          <CardDescription>
            Your account isn&apos;t linked to a facility yet. Ask a super admin
            to assign you, or sign in as super admin to create one.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

export const metadata = { title: "Facility Settings | MFO / Rink Reports" }

export default async function FacilitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const current = await requireAdmin()
  if (!current.profile) {
    return <NotSignedIn />
  }

  const profile = current.profile
  const supabase = await createClient()
  const sp = await searchParams
  const selectedId = pickIdParam(sp.id)

  // Super admin: full management.
  if (profile.is_super_admin) {
    const [facilities, selectedFacility] = await Promise.all([
      loadAllFacilities(supabase),
      selectedId ? loadFacilityById(supabase, selectedId) : Promise.resolve(null),
    ])

    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <PageHeader
          title="Facilities"
          description="Manage every facility in the system. Create new facilities and edit existing ones."
          actions={<NewFacilityButton />}
        />

        <FacilitiesTable
          facilities={facilities}
          selectedId={selectedFacility?.id ?? null}
        />

        {selectedId && !selectedFacility && (
          <Card>
            <CardHeader>
              <CardTitle>Facility not found</CardTitle>
              <CardDescription>
                The facility you tried to edit doesn&apos;t exist or has been
                removed.{" "}
                <Link href="/admin/facility" className="underline">
                  Back to list
                </Link>
                .
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {selectedFacility && (
          <EditFacilitySection facility={selectedFacility} />
        )}
      </div>
    )
  }

  // Regular admin scoped to a single facility.
  if (profile.facility_id) {
    const [facility, counts] = await Promise.all([
      loadFacilityById(supabase, profile.facility_id),
      loadFacilityCounts(supabase, profile.facility_id),
    ])

    if (!facility) {
      return (
        <div className="flex flex-col gap-6 p-4 md:p-6">
          <PageHeader title="Facility Settings" />
          <Card>
            <CardHeader>
              <CardTitle>Facility unavailable</CardTitle>
              <CardDescription>
                We couldn&apos;t load your facility. Contact a super admin if
                this keeps happening.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <PageHeader
          title={facility.name}
          description="Read-only view of your facility settings."
        />
        <ReadOnlyFacilityView facility={facility} counts={counts} />
      </div>
    )
  }

  // Signed in but no facility assigned and not super admin.
  return <NoFacilityAssigned />
}
