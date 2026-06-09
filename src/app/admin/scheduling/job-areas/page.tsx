import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  JobAreasClient,
  type CertRequirementRow,
  type JobAreaRow,
} from "./_components/job-areas-client"

export const dynamic = "force-dynamic"

export const metadata = { title: "Job Areas | MFO / Rink Reports" }

export default async function JobAreasPage() {
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
              Create a facility before configuring job areas.
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
  const sb = supabase
  const [{ data }, { data: reqData }] = await Promise.all([
    sb
      .from("employee_job_areas")
      .select("id, name, is_active, sort_order")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    sb
      .from("job_area_certification_requirements")
      .select("id, job_area_id, cert_name")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("cert_name", { ascending: true }),
  ])

  const areas = (data ?? []) as JobAreaRow[]
  const requirements = (reqData ?? []) as CertRequirementRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <JobAreasClient
        facilityId={facilityId}
        initialAreas={areas}
        initialRequirements={requirements}
      />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Job areas</h1>
      <p className="text-muted-foreground text-sm">
        The areas employees can be assigned to (e.g. Front Desk, Concessions).
        Used when assigning staff in the employee forms. Each employee can hold
        up to four.
      </p>
    </div>
  )
}
