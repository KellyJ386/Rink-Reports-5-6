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
import type { Tables } from "@/types/database"

import { ComplianceClient } from "./_components/compliance-client"
import { OverridesList, type OverrideRow } from "./_components/overrides-list"

export const dynamic = "force-dynamic"

export const metadata = { title: "Compliance Rules | MFO / Rink Reports" }

export default async function CompliancePage() {
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
              Create a facility before configuring compliance rules.
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
  const { data: rulesRaw } = await supabase
    .from("schedule_compliance_rules")
    .select(
      "id, facility_id, rule_type, name, description, params, is_active, sort_order, created_at, updated_at"
    )
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("rule_type", { ascending: true })

  const rules = (rulesRaw ?? []) as Tables<"schedule_compliance_rules">[]

  const [overrideRows, { data: facilityRow }] = await Promise.all([
    loadOverrides(supabase, facilityId),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle<{ timezone: string | null }>(),
  ])

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <ComplianceClient rules={rules} />
      <OverridesList
        rows={overrideRows}
        timeZone={facilityRow?.timezone ?? null}
      />
    </div>
  )
}

/**
 * Load the cert-override audit log (RLS already scopes SELECT to scheduling
 * admins in-facility), resolving employee + job-area names via lookup maps to
 * avoid embedded-join disambiguation between the two employee FKs.
 */
async function loadOverrides(
  supabase: Awaited<ReturnType<typeof createClient>>,
  facilityId: string
): Promise<OverrideRow[]> {
  const { data: raw } = await supabase
    .from("schedule_assignment_overrides")
    .select(
      "id, created_at, employee_id, job_area_id, missing_certs, reason, overridden_by_employee_id"
    )
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(100)

  const overrides = (raw ?? []) as Array<
    Pick<
      Tables<"schedule_assignment_overrides">,
      | "id"
      | "created_at"
      | "employee_id"
      | "job_area_id"
      | "missing_certs"
      | "reason"
      | "overridden_by_employee_id"
    >
  >
  if (overrides.length === 0) return []

  const employeeIds = Array.from(
    new Set(
      overrides
        .flatMap((o) => [o.employee_id, o.overridden_by_employee_id])
        .filter((x): x is string => !!x)
    )
  )
  const jobAreaIds = Array.from(
    new Set(overrides.map((o) => o.job_area_id).filter((x): x is string => !!x))
  )

  const [{ data: emps }, { data: areas }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", employeeIds.length > 0 ? employeeIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase
      .from("employee_job_areas")
      .select("id, name")
      .in("id", jobAreaIds.length > 0 ? jobAreaIds : ["00000000-0000-0000-0000-000000000000"]),
  ])

  const empName = new Map(
    ((emps ?? []) as Array<{ id: string; first_name: string; last_name: string }>).map(
      (e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]
    )
  )
  const areaName = new Map(
    ((areas ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name])
  )

  return overrides.map((o) => ({
    id: o.id,
    createdAt: o.created_at,
    employeeName: (o.employee_id && empName.get(o.employee_id)) || "Unknown",
    jobAreaName: (o.job_area_id && areaName.get(o.job_area_id)) || "—",
    missingCerts: o.missing_certs ?? [],
    reason: o.reason,
    overriddenByName:
      (o.overridden_by_employee_id && empName.get(o.overridden_by_employee_id)) ||
      "Unknown",
  }))
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Compliance rules
      </h1>
      <p className="text-muted-foreground text-sm">
        Define facility-level rules that drive scheduling warnings.
      </p>
    </div>
  )
}
