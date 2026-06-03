import { Breadcrumb } from "@/components/ui/breadcrumb"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { SubmissionForm } from "./_components/submission-form"

export const dynamic = "force-dynamic"

type Params = {
  areaSlug: string
  templateId: string
}

export default async function DailyReportSubmitPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { areaSlug, templateId } = await params
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

  const { data: template } = await supabase
    .from("daily_report_templates")
    .select("id, name, area_id, facility_id, is_active")
    .eq("id", templateId)
    .eq("facility_id", employeeRow.facility_id)
    .eq("area_id", area.id)
    .maybeSingle()

  if (!template || !template.is_active) {
    return (
      <NotAvailable
        title="Template not found"
        description="This template doesn't exist or is no longer active."
      />
    )
  }

  const { data: items } = await supabase
    .from("daily_report_checklist_items")
    .select("id, label, description, is_active, sort_order")
    .eq("template_id", template.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })

  const checklist = (items ?? []).map((it) => ({
    id: it.id,
    label: it.label,
    description: it.description,
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Breadcrumb
        segments={[
          { label: "Reports", href: "/reports" },
          { label: "Daily Reports", href: "/reports/daily" },
          { label: area.name, href: `/reports/daily/${area.slug}` },
          { label: template.name },
        ]}
      />
      <SubmissionForm
        areaId={area.id}
        areaSlug={area.slug}
        areaName={area.name}
        areaColor={area.color}
        templateId={template.id}
        templateName={template.name}
        userName={userName}
        facilityName={facility?.name ?? "Facility"}
        items={checklist}
      />
    </div>
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
