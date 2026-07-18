import Link from "next/link"
import { cache } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { ExportButton } from "@/components/admin/export-button"
import { LoadMoreLink } from "@/components/admin/load-more-link"
import { requireAdmin, requireModuleAdmin } from "@/lib/auth"
import { clampShow, nextShow } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"
import { formatInTz } from "@/lib/timezone"

import { AssignmentRecordCard } from "@/app/reports/daily/_components/assignment-record"
import { getAssignmentRecord } from "@/app/reports/daily/_lib/assignments"

import { AreaAccessTab } from "./_components/area-access-tab"
import { AreasTab } from "./_components/areas-tab"
import { AssignmentConfigTab } from "./_components/assignment-config-tab"
import { ItemsTab } from "./_components/items-tab"
import { SubmissionDetailPanel } from "./_components/submission-detail"
import { SubmissionFilters } from "./_components/submission-filters"
import { TemplatesTab } from "./_components/templates-tab"
import type {
  AreaRow,
  ChecklistItemRow,
  EmployeeLite,
  NoteRow,
  SubmissionDetail,
  SubmissionItemRow,
  SubmissionListItem,
  SubmissionRow,
  Tab,
  TemplateRow,
} from "./types"
import { TABS } from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  area?: string
  template?: string
  submission?: string
  employee?: string
  from?: string
  to?: string
  show?: string
}>

// React's `cache` makes the impure read deterministic for the duration of a
// request. eslint's `react-hooks/purity` rule otherwise rejects `Date.now()`
// inside a server component.
const fourteenDaysAgoCutoff = cache((): string =>
  new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10),
)

function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "areas"
}

function tabHref(
  tab: Tab,
  carry: { area?: string; template?: string },
): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  if (carry.area && (tab === "templates" || tab === "items" || tab === "submissions")) {
    sp.set("area", carry.area)
  }
  if (carry.template && tab === "items") {
    sp.set("template", carry.template)
  }
  return `/admin/daily-reports?${sp.toString()}`
}

export const metadata = { title: "Daily Reports | MFO / Rink Reports" }

export default async function DailyReportsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  // The daily-reports RLS policies (writes + admin-scope reads) gate on the
  // module-scoped admin grant, which requireAdmin does not imply. Without
  // this, a global admin lacking the grant gets a console whose every write
  // dies at the RLS layer.
  await requireModuleAdmin("daily_reports")
  const params = await searchParams
  const tab = asTab(params.tab)
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before configuring daily reports.
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

  // Always-loaded: areas (used by every tab for the picker / nav state).
  const { data: areasRaw } = await supabase
    .from("daily_report_areas")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  const areas = (areasRaw ?? []) as AreaRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <TabBar
        active={tab}
        carry={{ area: params.area, template: params.template }}
      />

      {tab === "areas" && <AreasTab areas={areas} />}

      {tab === "templates" && (
        <TemplatesTabLoader
          facilityId={facilityId}
          areas={areas}
          areaId={params.area ?? null}
        />
      )}

      {tab === "items" && (
        <ItemsTabLoader
          facilityId={facilityId}
          areas={areas}
          areaId={params.area ?? null}
          templateId={params.template ?? null}
        />
      )}

      {tab === "access" && (
        <AccessTabLoader facilityId={facilityId} areas={areas} />
      )}

      {tab === "assignments" && (
        <AssignmentsTabLoader facilityId={facilityId} areas={areas} />
      )}

      {tab === "submissions" && (
        <SubmissionsTabLoader
          facilityId={facilityId}
          areas={areas}
          params={params}
        />
      )}
    </div>
  )
}

async function AccessTabLoader({
  facilityId,
  areas,
}: {
  facilityId: string
  areas: AreaRow[]
}) {
  const supabase = await createClient()
  const [{ data: empsRaw }, { data: permsRaw }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name, email")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true }),
    supabase
      .from("module_area_permissions")
      .select("employee_id, area_id, can_submit")
      .eq("facility_id", facilityId)
      .eq("module_key", "daily_reports"),
  ])

  const employees = (empsRaw ?? []) as Array<{
    id: string
    first_name: string
    last_name: string
    email: string | null
  }>
  const initialGrants = (permsRaw ?? [])
    .filter((p) => p.can_submit)
    .map((p) => `${p.employee_id}:${p.area_id}`)
  const activeAreas = areas
    .filter((a) => a.is_active)
    .map((a) => ({ id: a.id, name: a.name, slug: a.slug, color: a.color }))

  return (
    <AreaAccessTab
      employees={employees}
      areas={activeAreas}
      initialGrants={initialGrants}
    />
  )
}

async function AssignmentsTabLoader({
  facilityId,
  areas,
}: {
  facilityId: string
  areas: AreaRow[]
}) {
  const supabase = await createClient()
  const [
    { data: settings },
    { data: empsRaw },
    { data: ownersRaw },
    { data: mapRaw },
    { data: jobAreasRaw },
  ] = await Promise.all([
    supabase
      .from("daily_report_settings")
      .select("assignment_routing_enabled, prelock_warning_minutes")
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("first_name", { ascending: true }),
    supabase
      .from("area_default_owners")
      .select("area_id, employee_id")
      .eq("facility_id", facilityId),
    supabase
      .from("daily_area_job_area_map")
      .select("area_id, job_area_id")
      .eq("facility_id", facilityId),
    // Reads the scheduling job-area catalog: RLS requires scheduling view, so
    // an admin without it simply sees an empty list (explained in the tab UI).
    supabase
      .from("employee_job_areas")
      .select("id, name")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])

  const defaultOwners: Record<string, string[]> = {}
  for (const row of ownersRaw ?? []) {
    ;(defaultOwners[row.area_id] ??= []).push(row.employee_id)
  }
  const jobAreaMap: Record<string, string[]> = {}
  for (const row of mapRaw ?? []) {
    ;(jobAreaMap[row.area_id] ??= []).push(row.job_area_id)
  }

  return (
    <AssignmentConfigTab
      settings={{
        enabled: settings?.assignment_routing_enabled ?? false,
        prelockWarningMinutes: settings?.prelock_warning_minutes ?? 60,
      }}
      areas={areas
        .filter((a) => a.is_active)
        .map((a) => ({ id: a.id, name: a.name, color: a.color }))}
      employees={(empsRaw ?? []).map((e) => ({
        id: e.id,
        name: `${e.first_name} ${e.last_name}`.trim(),
      }))}
      jobAreas={(jobAreasRaw ?? []).map((j) => ({ id: j.id, name: j.name }))}
      defaultOwners={defaultOwners}
      jobAreaMap={jobAreaMap}
    />
  )
}

function Header() {
  return (
    <PageHeader
      title="Daily Reports"
      description="Configure areas, templates, and checklists. Review and edit recent submissions. Reports auto-delete after 14 days."
      actions={<ExportButton moduleKey="daily_reports" />}
    />
  )
}

function TabBar({
  active,
  carry,
}: {
  active: Tab
  carry: { area?: string; template?: string }
}) {
  return (
    <TabNav
      ariaLabel="Daily reports sections"
      activeHref={tabHref(active, carry)}
      items={TABS.map((t) => ({
        label: t.label,
        href: tabHref(t.key, carry),
      }))}
    />
  )
}

// ---------------------------------------------------------------------------
// Per-tab data loaders (keep page.tsx readable; all server-side).
// ---------------------------------------------------------------------------

async function TemplatesTabLoader({
  facilityId,
  areas,
  areaId,
}: {
  facilityId: string
  areas: AreaRow[]
  areaId: string | null
}) {
  const supabase = await createClient()
  let templates: TemplateRow[] = []
  if (areaId) {
    const { data } = await supabase
      .from("daily_report_templates")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("area_id", areaId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
    templates = (data ?? []) as TemplateRow[]
  }
  return (
    <TemplatesTab
      areas={areas}
      selectedAreaId={areaId}
      templates={templates}
    />
  )
}

async function ItemsTabLoader({
  facilityId,
  areas,
  areaId,
  templateId,
}: {
  facilityId: string
  areas: AreaRow[]
  areaId: string | null
  templateId: string | null
}) {
  const supabase = await createClient()
  let templates: TemplateRow[] = []
  if (areaId) {
    const { data } = await supabase
      .from("daily_report_templates")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("area_id", areaId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
    templates = (data ?? []) as TemplateRow[]
  }
  let items: ChecklistItemRow[] = []
  // Only show items if the template belongs to the selected area.
  const validTemplate = templateId
    ? templates.find((t) => t.id === templateId)
    : null
  if (validTemplate) {
    const { data } = await supabase
      .from("daily_report_checklist_items")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("template_id", validTemplate.id)
      .order("sort_order", { ascending: true })
    items = (data ?? []) as ChecklistItemRow[]
  }
  return (
    <ItemsTab
      areas={areas}
      templates={templates}
      items={items}
      selectedAreaId={areaId}
      selectedTemplateId={validTemplate?.id ?? null}
    />
  )
}

async function SubmissionsTabLoader({
  facilityId,
  areas,
  params,
}: {
  facilityId: string
  areas: AreaRow[]
  params: {
    area?: string
    employee?: string
    from?: string
    to?: string
    submission?: string
    show?: string
  }
}) {
  const supabase = await createClient()

  // Default window: last 14 days (DB cron purges older rows anyway).
  const fromDate = params.from ?? fourteenDaysAgoCutoff()
  const toDate = params.to ?? null
  const show = clampShow(params.show, { initial: 200 })

  // Pull employees scoped to facility for the filter dropdown, plus the
  // facility timezone so timestamps render as facility wall-clock (the server
  // runs in UTC; the viewer's browser may be anywhere).
  const [{ data: empsRaw }, { data: facilityRow }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true }),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle(),
  ])
  const employees = (empsRaw ?? []) as EmployeeLite[]
  const timezone = facilityRow?.timezone ?? null

  // Submissions list query.
  let q = supabase
    .from("daily_report_submissions")
    .select("*")
    .eq("facility_id", facilityId)
    .gte("submitted_at", `${fromDate}T00:00:00.000Z`)
    .order("submitted_at", { ascending: false })
    // One extra row to learn whether a "Load more" link is needed.
    .range(0, show)
  if (params.area) q = q.eq("area_id", params.area)
  if (params.employee) q = q.eq("employee_id", params.employee)
  if (toDate) q = q.lte("submitted_at", `${toDate}T23:59:59.999Z`)

  const { data: subsRaw } = await q
  const overfetched = (subsRaw ?? []) as SubmissionRow[]
  const hasMore = overfetched.length > show
  const subs = hasMore ? overfetched.slice(0, show) : overfetched

  // Pull related counts in batches (avoid N+1 by fetching all items+notes for
  // the listed submissions in one round-trip each).
  const subIds = subs.map((s) => s.id)
  let itemRows: Array<Pick<SubmissionItemRow, "submission_id" | "is_checked">> = []
  let noteRows: Array<Pick<NoteRow, "submission_id">> = []
  if (subIds.length > 0) {
    const [itemsRes, notesRes] = await Promise.all([
      supabase
        .from("daily_report_submission_items")
        .select("submission_id, is_checked")
        .in("submission_id", subIds),
      supabase
        .from("daily_report_notes")
        .select("submission_id")
        .in("submission_id", subIds),
    ])
    itemRows = itemsRes.data ?? []
    noteRows = notesRes.data ?? []
  }

  // Pull templates referenced by listed submissions.
  const tplIds = Array.from(new Set(subs.map((s) => s.template_id)))
  const empIds = Array.from(
    new Set(subs.map((s) => s.employee_id).filter((x): x is string => !!x)),
  )
  const [tplRes, listedEmpRes] = await Promise.all([
    tplIds.length
      ? supabase
          .from("daily_report_templates")
          .select("id, name")
          .in("id", tplIds)
      : Promise.resolve({ data: [] as Array<Pick<TemplateRow, "id" | "name">> }),
    empIds.length
      ? supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", empIds)
      : Promise.resolve({ data: [] as EmployeeLite[] }),
  ])
  const templatesById = new Map(
    (tplRes.data ?? []).map((t) => [t.id, t as Pick<TemplateRow, "id" | "name">]),
  )
  const empsById = new Map(
    (listedEmpRes.data ?? []).map((e) => [e.id, e as EmployeeLite]),
  )
  const areasById = new Map(areas.map((a) => [a.id, a]))

  const itemAgg = new Map<string, { total: number; checked: number }>()
  for (const r of itemRows) {
    const cur = itemAgg.get(r.submission_id) ?? { total: 0, checked: 0 }
    cur.total += 1
    if (r.is_checked) cur.checked += 1
    itemAgg.set(r.submission_id, cur)
  }
  const noteAgg = new Map<string, number>()
  for (const r of noteRows) {
    noteAgg.set(r.submission_id, (noteAgg.get(r.submission_id) ?? 0) + 1)
  }

  const list: SubmissionListItem[] = subs.map((s) => {
    const a = areasById.get(s.area_id) ?? null
    const t = templatesById.get(s.template_id) ?? null
    const e = s.employee_id ? (empsById.get(s.employee_id) ?? null) : null
    const counts = itemAgg.get(s.id) ?? { total: 0, checked: 0 }
    return {
      ...s,
      area: a ? { id: a.id, name: a.name, color: a.color } : null,
      template: t ? { id: t.id, name: t.name } : null,
      employee: e,
      item_count: counts.total,
      checked_count: counts.checked,
      note_count: noteAgg.get(s.id) ?? 0,
    }
  })

  // If a specific submission is selected, load its detail.
  let detail: SubmissionDetail | null = null
  if (params.submission) {
    const sub = subs.find((s) => s.id === params.submission) ?? null
    // If submission isn't in the current list (filter mismatch), still try to
    // load it directly so deep links work.
    let baseSub: SubmissionRow | null = sub
    if (!baseSub) {
      const { data } = await supabase
        .from("daily_report_submissions")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.submission)
        .maybeSingle()
      baseSub = (data ?? null) as SubmissionRow | null
    }
    if (baseSub) {
      const [itemsRes, notesRes, tplRes2, empRes2, areaRes2] =
        await Promise.all([
          supabase
            .from("daily_report_submission_items")
            .select("*")
            .eq("submission_id", baseSub.id)
            .order("created_at", { ascending: true }),
          supabase
            .from("daily_report_notes")
            .select("*")
            .eq("submission_id", baseSub.id)
            .order("created_at", { ascending: true }),
          supabase
            .from("daily_report_templates")
            .select("id, name, description")
            .eq("id", baseSub.template_id)
            .maybeSingle(),
          baseSub.employee_id
            ? supabase
                .from("employees")
                .select("id, first_name, last_name")
                .eq("id", baseSub.employee_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          supabase
            .from("daily_report_areas")
            .select("id, name, color, slug")
            .eq("id", baseSub.area_id)
            .maybeSingle(),
        ])

      const noteRowsFull = (notesRes.data ?? []) as NoteRow[]
      const noteAuthorIds = Array.from(
        new Set(
          noteRowsFull
            .map((n) => n.employee_id)
            .filter((x): x is string => !!x),
        ),
      )
      let authors: EmployeeLite[] = []
      if (noteAuthorIds.length > 0) {
        const { data: authData } = await supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", noteAuthorIds)
        authors = (authData ?? []) as EmployeeLite[]
      }
      const authorById = new Map(authors.map((a) => [a.id, a]))

      detail = {
        submission: baseSub,
        area: (areaRes2.data ?? null) as
          | Pick<AreaRow, "id" | "name" | "color" | "slug">
          | null,
        template: (tplRes2.data ?? null) as
          | Pick<TemplateRow, "id" | "name" | "description">
          | null,
        employee: (empRes2.data ?? null) as EmployeeLite | null,
        items: (itemsRes.data ?? []) as SubmissionItemRow[],
        notes: noteRowsFull.map((n) => ({
          ...n,
          author: n.employee_id ? (authorById.get(n.employee_id) ?? null) : null,
        })),
      }
    }
  }

  // Build back href (drop submission param, keep filters).
  const backSp = new URLSearchParams()
  backSp.set("tab", "submissions")
  if (params.area) backSp.set("area", params.area)
  if (params.employee) backSp.set("employee", params.employee)
  if (params.from) backSp.set("from", params.from)
  if (params.to) backSp.set("to", params.to)
  const backHref = `/admin/daily-reports?${backSp.toString()}`

  // Frozen assignment record for closed days (migration 185): the same
  // "Assigned to X — not completed" / "Completed by X" flags the staff
  // history shows, surfaced where supervisors review past days. Empty (and
  // invisible) when routing was never enabled. Hidden while a submission
  // detail is open to keep the panel focused.
  const assignmentRecord = detail ? [] : await getAssignmentRecord()

  return (
    <div className="flex flex-col gap-4">
      <SubmissionFilters
        areas={areas}
        employees={employees}
        selectedAreaId={params.area ?? null}
        selectedEmployeeId={params.employee ?? null}
        from={params.from ?? null}
        to={params.to ?? null}
      />

      <AssignmentRecordCard days={assignmentRecord} />

      {detail ? (
        <SubmissionDetailPanel
          detail={detail}
          backHref={backHref}
          timezone={timezone}
        />
      ) : list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No submissions in this window</CardTitle>
            <CardDescription>
              Daily reports auto-delete after 14 days. Adjust the filters above
              to look at a different range.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <SubmissionsList list={list} params={params} timezone={timezone} />
          {!detail && hasMore && nextShow(show, { initial: 200 }) ? (
            <LoadMoreLink
              href={loadMoreHref(params, nextShow(show, { initial: 200 }))}
              shown={list.length}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function loadMoreHref(
  params: {
    area?: string
    employee?: string
    from?: string
    to?: string
  },
  show: number | null,
): string {
  const sp = new URLSearchParams()
  sp.set("tab", "submissions")
  if (params.area) sp.set("area", params.area)
  if (params.employee) sp.set("employee", params.employee)
  if (params.from) sp.set("from", params.from)
  if (params.to) sp.set("to", params.to)
  if (show) sp.set("show", String(show))
  return `/admin/daily-reports?${sp.toString()}`
}

function SubmissionsList({
  list,
  params,
  timezone,
}: {
  list: SubmissionListItem[]
  params: { area?: string; employee?: string; from?: string; to?: string }
  timezone: string | null
}) {
  function detailHref(id: string): string {
    const sp = new URLSearchParams()
    sp.set("tab", "submissions")
    sp.set("submission", id)
    if (params.area) sp.set("area", params.area)
    if (params.employee) sp.set("employee", params.employee)
    if (params.from) sp.set("from", params.from)
    if (params.to) sp.set("to", params.to)
    return `/admin/daily-reports?${sp.toString()}`
  }

  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">
              Submitted
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Area</th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Template
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Employee
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Items
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Notes
            </th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle">
                {formatInTz(s.submitted_at, timezone)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <span className="inline-flex items-center gap-1.5">
                  {s.area?.color && (
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: s.area.color }}
                    />
                  )}
                  {s.area?.name ?? "—"}
                </span>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.template?.name ?? "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.employee
                  ? `${s.employee.first_name} ${s.employee.last_name}`
                  : "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle tabular-nums">
                {s.checked_count}/{s.item_count}
              </td>
              <td className="border-b px-3 py-2 align-middle tabular-nums">
                {s.note_count}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <div className="flex justify-end">
                  <Link
                    href={detailHref(s.id)}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    Open
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
