import { notFound } from "next/navigation"

import { Breadcrumb } from "@/components/ui/breadcrumb"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  parseSnapshot,
  type ResponsesMap,
} from "../../_lib/instance-compute"
import { InstanceEditor } from "../_components/instance-editor"

export const dynamic = "force-dynamic"

export const metadata = { title: "Report | MFO / Rink Reports" }

export default async function ReportInstancePage({
  params,
}: {
  params: Promise<{ instanceId: string }>
}) {
  const { instanceId } = await params
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (!employeeRow) notFound()

  // RLS scopes this read (owner / area view / module admin).
  const { data: row } = await supabase
    .from("daily_report_instances")
    .select(
      "id, area_id, report_date, title, status, employee_id, template_snapshot, responses, submitted_at",
    )
    .eq("id", instanceId)
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()
  if (!row) notFound()

  const snapshot = parseSnapshot(row.template_snapshot)
  if (!snapshot) notFound()

  const [{ data: lockRow }, { data: areaRow }] = await Promise.all([
    supabase
      .from("daily_report_day_locks")
      .select("id")
      .eq("facility_id", employeeRow.facility_id)
      .eq("report_date", row.report_date)
      .maybeSingle(),
    supabase
      .from("daily_report_areas")
      .select("name")
      .eq("id", row.area_id)
      .maybeSingle(),
  ])

  const locked = Boolean(lockRow)
  const mine = row.employee_id === employeeRow.id
  const editable = mine && row.status === "draft" && !locked

  const responses =
    row.responses && typeof row.responses === "object" && !Array.isArray(row.responses)
      ? (row.responses as ResponsesMap)
      : {}

  return (
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
              { label: "Report Forms", href: "/reports/daily/forms" },
              { label: row.title },
            ]}
          />
        }
        title={row.title}
      />
      <InstanceEditor
        instanceId={row.id}
        areaName={areaRow?.name ?? null}
        reportDate={row.report_date}
        status={row.status === "submitted" ? "submitted" : "draft"}
        snapshot={snapshot}
        initialResponses={responses}
        editable={editable}
        locked={locked}
        mine={mine}
      />
    </div>
  )
}
