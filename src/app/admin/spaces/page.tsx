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
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { SpacesTab } from "./_components/spaces-tab"
import type { FacilitySpaceRow } from "./types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Facility Spaces | MFO / Rink Reports" }

export default async function FacilitySpacesAdminPage() {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before managing its spaces.
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
  const { data } = await supabase
    .from("facility_spaces")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  const spaces = (data ?? []) as FacilitySpaceRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <SpacesTab spaces={spaces} />
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Facility Spaces"
      description="The shared list of physical areas for this facility. These feed the space/location pickers in Incident Reports, Accident Reports, and Air Quality."
    />
  )
}
