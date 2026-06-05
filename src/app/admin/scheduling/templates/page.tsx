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

import type {
  DepartmentLite,
  JobAreaLite,
  TemplateRow,
  TemplateShiftRow,
} from "../_lib/types"

import { TemplatesClient } from "./_components/templates-client"

export const dynamic = "force-dynamic"

// employee_job_areas isn't in the generated DB types yet (see CLAUDE.md).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

type SearchParams = Promise<{ template?: string }>

export const metadata = { title: "Schedule Templates | MFO / Rink Reports" }

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null
  const params = await searchParams

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before authoring templates.
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

  const [templatesRes, deptsRes, jobAreasRes] = await Promise.all([
    supabase
      .from("schedule_templates")
      .select("*")
      .eq("facility_id", facilityId)
      .order("name", { ascending: true }),
    supabase
      .from("departments")
      .select("id, name, slug, color, is_active")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    (supabase as AnySupabase)
      .from("employee_job_areas")
      .select("id, name, slug, is_active")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])

  const templates = (templatesRes.data ?? []) as TemplateRow[]
  const departments = (deptsRes.data ?? []) as DepartmentLite[]
  const jobAreas = (jobAreasRes.data ?? []) as JobAreaLite[]

  let selectedShifts: TemplateShiftRow[] = []
  const selected = params.template
    ? templates.find((t) => t.id === params.template) ?? null
    : null

  if (selected) {
    const { data } = await supabase
      .from("schedule_template_shifts")
      .select("*")
      .eq("template_id", selected.id)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true })
    selectedShifts = (data ?? []) as TemplateShiftRow[]
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <TemplatesClient
        templates={templates}
        departments={departments}
        jobAreas={jobAreas}
        selected={selected}
        selectedShifts={selectedShifts}
      />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
      <p className="text-muted-foreground text-sm">
        Define recurring schedule templates and apply them to a week.
      </p>
    </div>
  )
}
