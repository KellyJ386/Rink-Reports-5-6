import type { ReactNode } from "react"

import { SignOutButton } from "@/components/staff/sign-out-button"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  DailyReportConsole,
  type ConsoleArea,
  type ConsoleItem,
  type ConsoleTemplate,
} from "./_components/daily-report-console"
import { getAllowedDailyAreas } from "./actions"

export const dynamic = "force-dynamic"

export default async function DailyReportsPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Account not ready</CardTitle>
            <CardDescription>
              Your account is being set up. Contact your administrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignOutButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Areas this user may submit to (per-area can_submit). Shared with the
  // server-side RLS boundary via getAllowedDailyAreas().
  const allowed = await getAllowedDailyAreas()

  const shell = (children: ReactNode) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="daily"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Daily Reports" },
            ]}
          />
        }
        title="Daily Reports"
      />
      {children}
    </div>
  )

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
      </Card>
    )
  }

  const areaIds = allowed.map((a) => a.id)

  // Templates for every assignable area (one query).
  const { data: templates } = await supabase
    .from("daily_report_templates")
    .select("id, area_id, name, description, sort_order")
    .eq("facility_id", employeeRow.facility_id)
    .in("area_id", areaIds)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  const templateRows = templates ?? []
  const templateIds = templateRows.map((t) => t.id)

  // Checklist items for every one of those templates (one query).
  const { data: items } = templateIds.length
    ? await supabase
        .from("daily_report_checklist_items")
        .select("id, template_id, label, description, sort_order")
        .in("template_id", templateIds)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true })
    : { data: [] as { id: string; template_id: string; label: string; description: string | null }[] }

  // Group items under their template (query order preserved).
  const itemsByTemplate = new Map<string, ConsoleItem[]>()
  for (const it of items ?? []) {
    const list = itemsByTemplate.get(it.template_id) ?? []
    list.push({ id: it.id, label: it.label, description: it.description })
    itemsByTemplate.set(it.template_id, list)
  }

  // Group templates under their area (query order preserved).
  const templatesByArea = new Map<string, ConsoleTemplate[]>()
  for (const t of templateRows) {
    const list = templatesByArea.get(t.area_id) ?? []
    list.push({
      id: t.id,
      name: t.name,
      description: t.description,
      items: itemsByTemplate.get(t.id) ?? [],
    })
    templatesByArea.set(t.area_id, list)
  }

  const areas: ConsoleArea[] = allowed.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    color: a.color,
    templates: templatesByArea.get(a.id) ?? [],
  }))

  const { data: facility } = await supabase
    .from("facilities")
    .select("name")
    .eq("id", employeeRow.facility_id)
    .maybeSingle()

  const userName =
    current.profile?.full_name ??
    current.profile?.email ??
    current.authUser.email ??
    "Staff"

  return shell(
    <DailyReportConsole
      areas={areas}
      userName={userName}
      facilityName={facility?.name ?? "Facility"}
    />
  )
}
