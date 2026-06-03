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

import { JobAreasClient, type JobAreaRow } from "./_components/job-areas-client"

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
  // employee_job_areas isn't in the generated types yet (see CLAUDE.md).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("employee_job_areas")
    .select("id, name, is_active, sort_order")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })

  const areas = (data ?? []) as JobAreaRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <JobAreasClient facilityId={facilityId} initialAreas={areas} />
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
