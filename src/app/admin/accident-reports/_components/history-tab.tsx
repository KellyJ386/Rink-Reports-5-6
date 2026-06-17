import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

import type {
  AccidentBodyPartSelectionRow,
  AccidentChangeLogRow,
  AccidentFollowupNoteRow,
  AccidentReportDetail,
  AccidentReportListItem,
  AccidentReportRow,
  AccidentReportWithAge,
  AccidentWitnessRow,
  BodyPartSelectionWithDropdown,
  DropdownLite,
  EmployeeLite,
} from "../types"

import { HistoryFilters } from "./history-filters"
import { ReportDetail } from "./report-detail"

type HistoryParams = {
  report?: string
  from?: string
  to?: string
  employee?: string
  severity?: string
  body_part?: string
  location?: string
  activity?: string
  medical_attention?: string
  wc?: string
}

const FILTER_KEYS = [
  "from",
  "to",
  "employee",
  "severity",
  "body_part",
  "location",
  "activity",
  "medical_attention",
  "wc",
] as const

function defaultFromDate(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString().slice(0, 10)
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function buildDetailHref(reportId: string, params: HistoryParams): string {
  const sp = new URLSearchParams()
  sp.set("tab", "history")
  sp.set("report", reportId)
  for (const k of FILTER_KEYS) {
    const v = params[k]
    if (v) sp.set(k, v)
  }
  return `/admin/accident-reports?${sp.toString()}`
}

function hasAnyExplicitFilter(p: HistoryParams): boolean {
  return Boolean(
    p.employee ||
      p.severity ||
      p.body_part ||
      p.location ||
      p.activity ||
      p.medical_attention ||
      p.wc ||
      p.from ||
      p.to,
  )
}

// ---------------------------------------------------------------------------
// Server loader
// ---------------------------------------------------------------------------

export async function HistoryTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: HistoryParams
}) {
  const supabase = await createClient()

  // Effective date range — default to last 30 days when not provided.
  const fromDate = params.from || defaultFromDate()
  const toDate = params.to || ""

  // Lookups for filter dropdowns and badge rendering. Location options come
  // from the shared facility_spaces list; everything else from accident_dropdowns.
  const [dropdownsRes, spacesRes, empsRes] = await Promise.all([
    supabase
      .from("accident_dropdowns")
      .select("id, key, display_name, color, category")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("facility_spaces")
      .select("id, name, slug")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true }),
  ])

  const dropdowns = (dropdownsRes.data ?? []) as DropdownLite[]
  const employees = (empsRes.data ?? []) as EmployeeLite[]

  // Map facility_spaces into the DropdownLite shape the views/filters expect.
  const locations: DropdownLite[] = (
    (spacesRes.data ?? []) as Array<{ id: string; name: string; slug: string }>
  ).map((s) => ({
    id: s.id,
    key: s.slug,
    display_name: s.name,
    color: null,
    category: "location",
  }))
  const spacesById = new Map(locations.map((l) => [l.id, l]))

  const dropdownsById = new Map(dropdowns.map((d) => [d.id, d]))
  const severities = dropdowns.filter((d) => d.category === "severity")
  const bodyParts = dropdowns.filter((d) => d.category === "body_part")
  const activities = dropdowns.filter((d) => d.category === "activity")
  const medicals = dropdowns.filter((d) => d.category === "medical_attention")

  // If filtering by body_part, narrow the report ids first via the join table.
  let bodyPartReportIds: string[] | null = null
  if (params.body_part) {
    const { data: bps } = await supabase
      .from("accident_body_part_selections")
      .select("accident_id")
      .eq("facility_id", facilityId)
      .eq("body_part_dropdown_id", params.body_part)
    const ids = (bps ?? []).map((r) => r.accident_id as string)
    bodyPartReportIds = Array.from(new Set(ids))
    if (bodyPartReportIds.length === 0) bodyPartReportIds = ["__none__"]
  }

  // Reports list query.
  let q = supabase
    .from("accident_reports")
    .select("*")
    .eq("facility_id", facilityId)
    .order("submitted_at", { ascending: false })
    .limit(200)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (params.severity) q = q.eq("severity_dropdown_id", params.severity)
  if (params.location) q = q.eq("location_dropdown_id", params.location)
  if (params.activity) q = q.eq("activity_dropdown_id", params.activity)
  if (params.medical_attention)
    q = q.eq("medical_attention_dropdown_id", params.medical_attention)
  if (params.wc === "yes") q = q.eq("workers_comp", true)
  if (params.wc === "no") q = q.eq("workers_comp", false)
  if (fromDate) q = q.gte("submitted_at", `${fromDate}T00:00:00.000Z`)
  if (toDate) q = q.lte("submitted_at", `${toDate}T23:59:59.999Z`)
  if (bodyPartReportIds) q = q.in("id", bodyPartReportIds)

  const { data: reportsRaw } = await q
  const reports = (reportsRaw ?? []) as AccidentReportRow[]

  // Resolve listed report employees.
  const empIds = Array.from(
    new Set(reports.map((r) => r.employee_id).filter((x): x is string => !!x)),
  )
  let listedEmployees: EmployeeLite[] = []
  if (empIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", empIds)
    listedEmployees = (data ?? []) as EmployeeLite[]
  }
  const empsById = new Map(listedEmployees.map((e) => [e.id, e]))

  // Body part counts for list view.
  const reportIds = reports.map((r) => r.id)
  const bodyPartCountByReport = new Map<string, number>()
  if (reportIds.length > 0) {
    const { data: allBps } = await supabase
      .from("accident_body_part_selections")
      .select("accident_id")
      .in("accident_id", reportIds)
    for (const row of (allBps ?? []) as Array<{ accident_id: string }>) {
      bodyPartCountByReport.set(
        row.accident_id,
        (bodyPartCountByReport.get(row.accident_id) ?? 0) + 1,
      )
    }
  }

  const list: AccidentReportListItem[] = reports.map((r) => ({
    ...r,
    injury_type: r.primary_injury_type_dropdown_id
      ? (dropdownsById.get(r.primary_injury_type_dropdown_id) ?? null)
      : null,
    location: r.location_dropdown_id
      ? (spacesById.get(r.location_dropdown_id) ?? null)
      : null,
    activity: r.activity_dropdown_id
      ? (dropdownsById.get(r.activity_dropdown_id) ?? null)
      : null,
    medical_attention: r.medical_attention_dropdown_id
      ? (dropdownsById.get(r.medical_attention_dropdown_id) ?? null)
      : null,
    severity: r.severity_dropdown_id
      ? (dropdownsById.get(r.severity_dropdown_id) ?? null)
      : null,
    employee: r.employee_id ? (empsById.get(r.employee_id) ?? null) : null,
  }))

  // Drilldown detail
  let detail: AccidentReportDetail | null = null
  if (params.report) {
    let baseReport = reports.find((r) => r.id === params.report) ?? null
    if (!baseReport) {
      const { data } = await supabase
        .from("accident_reports")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.report)
        .maybeSingle()
      baseReport = (data ?? null) as AccidentReportRow | null
    }
    if (baseReport) {
      const [bpsRes, witnessRes, notesRes, logRes, reporterRes] = await Promise.all([
        supabase
          .from("accident_body_part_selections")
          .select("*")
          .eq("accident_id", baseReport.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("accident_witnesses")
          .select("id, facility_id, accident_id, name, contact, statement, sort_order, created_at, updated_at")
          .eq("accident_id", baseReport.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("accident_followup_notes")
          .select("*")
          .eq("accident_id", baseReport.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("accident_change_log")
          .select("*")
          .eq("accident_id", baseReport.id)
          .order("created_at", { ascending: false }),
        baseReport.employee_id
          ? supabase
              .from("employees")
              .select("id, first_name, last_name")
              .eq("id", baseReport.employee_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const bpsRows = (bpsRes.data ?? []) as AccidentBodyPartSelectionRow[]
      const witnessRows = (witnessRes.data ?? []) as AccidentWitnessRow[]
      const noteRows = (notesRes.data ?? []) as AccidentFollowupNoteRow[]
      const logRows = (logRes.data ?? []) as AccidentChangeLogRow[]

      const noteAuthorIds = noteRows
        .map((n) => n.employee_id)
        .filter((x): x is string => !!x)
      const logActorIds = logRows
        .map((l) => l.employee_id)
        .filter((x): x is string => !!x)
      const allEmpIds = Array.from(
        new Set([...noteAuthorIds, ...logActorIds]),
      )
      let extras: EmployeeLite[] = []
      if (allEmpIds.length > 0) {
        const { data } = await supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", allEmpIds)
        extras = (data ?? []) as EmployeeLite[]
      }
      const extrasById = new Map(extras.map((e) => [e.id, e]))

      const bps: BodyPartSelectionWithDropdown[] = bpsRows.map((b) => ({
        ...b,
        body_part: dropdownsById.get(b.body_part_dropdown_id) ?? null,
      }))

      detail = {
        report: baseReport as AccidentReportWithAge,
        injury_type: baseReport.primary_injury_type_dropdown_id
          ? (dropdownsById.get(baseReport.primary_injury_type_dropdown_id) ??
            null)
          : null,
        location: baseReport.location_dropdown_id
          ? (spacesById.get(baseReport.location_dropdown_id) ?? null)
          : null,
        activity: baseReport.activity_dropdown_id
          ? (dropdownsById.get(baseReport.activity_dropdown_id) ?? null)
          : null,
        medical_attention: baseReport.medical_attention_dropdown_id
          ? (dropdownsById.get(baseReport.medical_attention_dropdown_id) ??
            null)
          : null,
        severity: baseReport.severity_dropdown_id
          ? (dropdownsById.get(baseReport.severity_dropdown_id) ?? null)
          : null,
        employee: (reporterRes.data ?? null) as EmployeeLite | null,
        body_parts: bps,
        witnesses: witnessRows,
        notes: noteRows.map((n) => ({
          ...n,
          author: n.employee_id ? (extrasById.get(n.employee_id) ?? null) : null,
        })),
        change_log: logRows.map((l) => ({
          ...l,
          actor: l.employee_id ? (extrasById.get(l.employee_id) ?? null) : null,
        })),
      }
    }
  }

  // Build back href (preserves filters, drops `report`).
  const backSp = new URLSearchParams()
  backSp.set("tab", "history")
  for (const k of FILTER_KEYS) {
    const v = params[k]
    if (v) backSp.set(k, v)
  }
  const backHref = `/admin/accident-reports?${backSp.toString()}`

  return (
    <HistoryTab
      list={list}
      detail={detail}
      backHref={backHref}
      employees={employees}
      severities={severities}
      bodyParts={bodyParts}
      locations={locations}
      activities={activities}
      medicals={medicals}
      bodyPartCountByReport={bodyPartCountByReport}
      params={{ ...params, from: fromDate, to: toDate }}
    />
  )
}

// ---------------------------------------------------------------------------
// View component
// ---------------------------------------------------------------------------

type Props = {
  list: AccidentReportListItem[]
  detail: AccidentReportDetail | null
  backHref: string
  employees: EmployeeLite[]
  severities: DropdownLite[]
  bodyParts: DropdownLite[]
  locations: DropdownLite[]
  activities: DropdownLite[]
  medicals: DropdownLite[]
  bodyPartCountByReport: Map<string, number>
  params: HistoryParams
}

function HistoryTab({
  list,
  detail,
  backHref,
  employees,
  severities,
  bodyParts,
  locations,
  activities,
  medicals,
  bodyPartCountByReport,
  params,
}: Props) {
  if (detail) {
    return <ReportDetail detail={detail} backHref={backHref} />
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilters
        employees={employees}
        severities={severities}
        bodyParts={bodyParts}
        locations={locations}
        activities={activities}
        medicals={medicals}
        params={params}
      />
      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasAnyExplicitFilter(params)
                ? "No reports match your filters"
                : "No accident reports submitted"}
            </CardTitle>
            <CardDescription>
              {hasAnyExplicitFilter(params)
                ? "Try widening the date range or clearing a filter."
                : "When staff submit reports, they'll appear here."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ReportsList
          list={list}
          params={params}
          bodyPartCountByReport={bodyPartCountByReport}
        />
      )}
    </div>
  )
}

function ReportsList({
  list,
  params,
  bodyPartCountByReport,
}: {
  list: AccidentReportListItem[]
  params: HistoryParams
  bodyPartCountByReport: Map<string, number>
}) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">
              Submitted
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Injured person
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Severity
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Medical
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Location
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Activity
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              W/C
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Body parts
            </th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle">
                {fmt(r.submitted_at)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.injured_person_name}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.severity ? (
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    style={
                      r.severity.color
                        ? {
                            backgroundColor: `${r.severity.color}22`,
                            color: r.severity.color,
                          }
                        : undefined
                    }
                  >
                    {r.severity.display_name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.medical_attention?.display_name ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.location?.display_name ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.activity?.display_name ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.workers_comp ? (
                  <Badge variant="warning">Yes</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">No</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle tabular-nums">
                {bodyPartCountByReport.get(r.id) ?? 0}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <div className="flex justify-end">
                  <Link
                    href={buildDetailHref(r.id, params)}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    View
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
