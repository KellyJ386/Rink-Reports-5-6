import { cache } from "react"

import Link from "next/link"
import { redirect } from "next/navigation"

import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

// React's `cache` makes the impure read deterministic for the duration of a
// request. eslint's `react-hooks/purity` rule otherwise rejects `Date.now()`
// inside a server component.
const nowMs = cache((): number => Date.now())

import type { BodyPartOption, DropdownOption } from "../types"

import { EditForm } from "./_components/edit-form"
import { ReadOnlyView } from "./_components/read-only-view"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type DropdownRow = {
  id: string
  category: string
  key: string
  display_name: string
  color: string | null
  sort_order: number
  metadata: unknown
}

type ReportRow = {
  id: string
  facility_id: string
  employee_id: string | null
  injured_person_name: string
  injured_person_contact: string
  description: string
  occurred_at: string
  submitted_at: string
  edit_window_ends_at: string
  workers_comp: boolean
  workers_comp_acknowledged_at: string | null
  location_dropdown_id: string | null
  activity_dropdown_id: string | null
  severity_dropdown_id: string | null
  medical_attention_dropdown_id: string | null
  primary_injury_type_dropdown_id: string | null
}

type BodyPartRow = {
  id: string
  body_part_dropdown_id: string
  side: string
}

function partition(rows: DropdownRow[]): {
  locations: DropdownOption[]
  activities: DropdownOption[]
  severities: DropdownOption[]
  medicalAttentions: DropdownOption[]
  injuryTypes: DropdownOption[]
  bodyParts: BodyPartOption[]
  byId: Map<string, DropdownRow>
} {
  const locations: DropdownOption[] = []
  const activities: DropdownOption[] = []
  const severities: DropdownOption[] = []
  const medicalAttentions: DropdownOption[] = []
  const injuryTypes: DropdownOption[] = []
  const bodyParts: BodyPartOption[] = []
  const byId = new Map<string, DropdownRow>()
  for (const r of rows) {
    byId.set(r.id, r)
    const opt: DropdownOption = {
      id: r.id,
      key: r.key,
      display_name: r.display_name,
      color: r.color,
    }
    switch (r.category) {
      case "location":
        locations.push(opt)
        break
      case "activity":
        activities.push(opt)
        break
      case "severity":
        severities.push(opt)
        break
      case "medical_attention": {
        const triggersAlert: boolean = !!(
          r.metadata &&
          typeof r.metadata === "object" &&
          !Array.isArray(r.metadata) &&
          (r.metadata as Record<string, unknown>).triggers_alert === true
        )
        medicalAttentions.push({ ...opt, triggersAlert })
        break
      }
      case "injury_type":
        injuryTypes.push(opt)
        break
      case "body_part":
        bodyParts.push({
          id: r.id,
          key: r.key,
          display_name: r.display_name,
        })
        break
    }
  }
  return {
    locations,
    activities,
    severities,
    medicalAttentions,
    injuryTypes,
    bodyParts,
    byId,
  }
}

export default async function AccidentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ submitted?: string | string[] }>
}) {
  const { id } = await params
  const sp = await searchParams

  if (!UUID_RE.test(id)) {
    redirect("/reports/accidents")
  }

  const submittedParam = Array.isArray(sp.submitted)
    ? sp.submitted[0]
    : sp.submitted
  const justSubmitted = submittedParam === "1"

  const current = await requireUser()
  const supabase = await createClient()

  const [{ data: employeeRow }, { data: reportRow }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, facility_id")
      .eq("user_id", current.authUser.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("accident_reports")
      .select(
        "id, facility_id, employee_id, injured_person_name, injured_person_contact, description, occurred_at, submitted_at, edit_window_ends_at, workers_comp, workers_comp_acknowledged_at, location_dropdown_id, activity_dropdown_id, severity_dropdown_id, medical_attention_dropdown_id, primary_injury_type_dropdown_id"
      )
      .eq("id", id)
      .maybeSingle(),
  ])

  if (!reportRow) {
    redirect("/reports/accidents")
  }

  const report = reportRow as ReportRow

  const [{ data: bpRowsRaw }, { data: dropdownRowsRaw }, { data: workersCompRow }, { data: facility }] =
    await Promise.all([
      supabase
        .from("accident_body_part_selections")
        .select("id, body_part_dropdown_id, side")
        .eq("accident_id", report.id),
      supabase
        .from("accident_dropdowns")
        .select("id, category, key, display_name, color, sort_order, metadata")
        .eq("facility_id", report.facility_id)
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true }),
      supabase
        .from("accident_workers_comp_settings")
        .select("instructions, is_active")
        .eq("facility_id", report.facility_id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("facilities")
        .select("timezone")
        .eq("id", report.facility_id)
        .maybeSingle(),
    ])

  const bodyPartRows = (bpRowsRaw ?? []) as BodyPartRow[]
  const dropdownRows = (dropdownRowsRaw ?? []) as DropdownRow[]
  const tz = facility?.timezone ?? null

  const { locations, activities, severities, medicalAttentions, injuryTypes, bodyParts, byId } =
    partition(dropdownRows)

  const isOwner =
    !!employeeRow && employeeRow.id === report.employee_id
  const requestNow = nowMs()
  const editWindowOpen =
    new Date(report.edit_window_ends_at).getTime() > requestNow
  const canEdit = isOwner && editWindowOpen

  const editWindowMs =
    new Date(report.edit_window_ends_at).getTime() - requestNow
  const editWindowHours = Math.max(0, Math.ceil(editWindowMs / (60 * 60 * 1000)))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          /{" "}
          <Link href="/reports/accidents" className="hover:underline">
            Accident Reports
          </Link>{" "}
          / Report
        </p>
      </div>

      {justSubmitted ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span>
              <span className="font-medium">Submitted.</span>{" "}
              <span className="text-muted-foreground">
                Thank you. You can review or edit this report below.
              </span>
            </span>
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <>
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
            Editable for {editWindowHours} more{" "}
            {editWindowHours === 1 ? "hour" : "hours"}.
          </div>
          <EditForm
            reportId={report.id}
            initialReport={report}
            initialBodyParts={bodyPartRows.map((r) => ({
              body_part_dropdown_id: r.body_part_dropdown_id,
              side: r.side,
            }))}
            locations={locations}
            activities={activities}
            severities={severities}
            medicalAttentions={medicalAttentions}
            injuryTypes={injuryTypes}
            bodyParts={bodyParts}
            workersCompInstructions={workersCompRow?.instructions ?? null}
          />
        </>
      ) : (
        <ReadOnlyView
          report={report}
          bodyPartRows={bodyPartRows}
          dropdownsById={byId}
          timezone={tz}
          editWindowOpen={editWindowOpen}
        />
      )}
    </div>
  )
}
