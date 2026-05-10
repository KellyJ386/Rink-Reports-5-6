import Link from "next/link"
import { redirect } from "next/navigation"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {

  TemplatesList,
  type TemplateCard,
} from "./_components/templates-list"

export const dynamic = "force-dynamic"

type Params = {
  areaSlug: string
}

export default async function DailyReportTemplatePickerPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { areaSlug } = await params
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
      <NotAvailable
        title="Account not ready"
        description="Your account is being set up. Contact your administrator."
      />
    )
  }

  const { data: area } = await supabase
    .from("daily_report_areas")
    .select("id, name, slug, color, facility_id, is_active")
    .eq("facility_id", employeeRow.facility_id)
    .eq("slug", areaSlug)
    .maybeSingle()

  if (!area || !area.is_active) {
    return (
      <NotAvailable
        title="Area not found"
        description="This area doesn't exist or isn't available."
      />
    )
  }

  // Confirm the staff has can_submit on this area for daily_reports.
  const { data: perm } = await supabase
    .from("module_area_permissions")
    .select("can_submit")
    .eq("module_key", "daily_reports")
    .eq("employee_id", employeeRow.id)
    .eq("area_id", area.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return (
      <NotAvailable
        title="No access"
        description="You don't have access to submit reports in this area."
      />
    )
  }

  const { data: templates } = await supabase
    .from("daily_report_templates")
    .select("id, name, description, is_active, sort_order")
    .eq("facility_id", employeeRow.facility_id)
    .eq("area_id", area.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  const active: TemplateCard[] = (templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }))

  if (active.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <Breadcrumbs areaName={area.name} />
        <Card>
          <CardHeader>
            <CardTitle>No templates yet</CardTitle>
            <CardDescription>
              This area has no templates yet. Talk to your supervisor.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (active.length === 1) {
    redirect(`/reports/daily/${area.slug}/${active[0]!.id}`)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <Breadcrumbs areaName={area.name} />
      <h1 className="text-2xl font-semibold tracking-tight">Pick a template</h1>
      <TemplatesList areaSlug={area.slug} templates={active} />
    </div>
  )
}

function Breadcrumbs({ areaName }: { areaName: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      <Link href="/reports" className="hover:underline">
        Reports
      </Link>{" "}
      /{" "}
      <Link href="/reports/daily" className="hover:underline">
        Daily Reports
      </Link>{" "}
      / {areaName}
    </p>
  )
}

function NotAvailable({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
