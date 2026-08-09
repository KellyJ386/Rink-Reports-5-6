import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { PageHeader } from "@/components/ui/page-header"
import { SignOutButton } from "@/components/staff/sign-out-button"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { businessDateInTimeZone } from "../_lib/compute"
import { getAllowedDailyAreas } from "../actions"
import { FormsBoard, type BoardArea, type BoardInstance } from "./_components/forms-board"

export const dynamic = "force-dynamic"

export const metadata = { title: "Report Forms | MFO / Rink Reports" }

export default async function DailyReportFormsPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="daily"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Daily Reports", href: "/reports/daily" },
              { label: "Report Forms" },
            ]}
          />
        }
        title="Report Forms"
      />
      {children}
    </div>
  )

  if (!employeeRow) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle>Account not ready</CardTitle>
          <CardDescription>
            Your account is being set up. Contact your administrator.
          </CardDescription>
        </CardHeader>
        <SignOutButton />
      </Card>,
    )
  }

  const allowed = await getAllowedDailyAreas()
  if (allowed.length === 0) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle>No areas assigned</CardTitle>
          <CardDescription>
            No daily report areas have been assigned to you yet. Talk to your
            supervisor.
          </CardDescription>
        </CardHeader>
      </Card>,
    )
  }

  const areaIds = allowed.map((a) => a.id)
  const { data: facilityRow } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", employeeRow.facility_id)
    .maybeSingle()
  const today = businessDateInTimeZone(new Date(), facilityRow?.timezone ?? null)

  // Current (non-superseded), active form templates in the user's areas;
  // today's instances in those areas; today's lock state — three queries.
  const [{ data: templatesRaw }, { data: instancesRaw }, { data: lockRow }] =
    await Promise.all([
      supabase
        .from("daily_report_form_templates")
        .select("id, area_id, name, version")
        .eq("facility_id", employeeRow.facility_id)
        .in("area_id", areaIds)
        .eq("is_active", true)
        .is("superseded_at", null)
        .order("name", { ascending: true }),
      supabase
        .from("daily_report_instances")
        .select("id, area_id, template_id, title, status, employee_id, updated_at, created_at")
        .eq("facility_id", employeeRow.facility_id)
        .eq("report_date", today)
        .in("area_id", areaIds)
        .order("created_at", { ascending: true }),
      supabase
        .from("daily_report_day_locks")
        .select("id")
        .eq("facility_id", employeeRow.facility_id)
        .eq("report_date", today)
        .maybeSingle(),
    ])

  const templates = templatesRaw ?? []
  const instances = instancesRaw ?? []

  // Owner names for the listed instances (one query).
  const ownerIds = Array.from(
    new Set(instances.map((i) => i.employee_id).filter((x): x is string => !!x)),
  )
  const { data: ownersRaw } = ownerIds.length
    ? await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .in("id", ownerIds)
    : { data: [] as Array<{ id: string; first_name: string; last_name: string }> }
  const ownersById = new Map((ownersRaw ?? []).map((o) => [o.id, o]))
  const templatesById = new Map(templates.map((t) => [t.id, t]))

  const boardAreas: BoardArea[] = allowed
    .map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      templates: templates
        .filter((t) => t.area_id === a.id)
        .map((t) => ({ id: t.id, name: t.name, version: t.version })),
      instances: instances
        .filter((i) => i.area_id === a.id)
        .map((i): BoardInstance => {
          const owner = i.employee_id ? ownersById.get(i.employee_id) : null
          return {
            id: i.id,
            title: i.title,
            status: i.status === "submitted" ? "submitted" : "draft",
            templateName: templatesById.get(i.template_id)?.name ?? "Form",
            ownerName: owner
              ? `${owner.first_name} ${owner.last_name}`.trim()
              : null,
            mine: i.employee_id === employeeRow.id,
          }
        }),
    }))
    // Only show areas that have at least a form or an instance today.
    .filter((a) => a.templates.length > 0 || a.instances.length > 0)

  return shell(
    <FormsBoard areas={boardAreas} today={today} locked={Boolean(lockRow)} />,
  )
}
