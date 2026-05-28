import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  MODULE_COLUMN_OPTIONS,
  MODULE_LABELS,
  type ExportSettingsRow,
} from "@/app/admin/exports/types"
import { MODULE_NAMES, type ModuleName } from "@/lib/permissions/actions"

import { formatExportDate } from "./format-date"
import type { ExportTable } from "./types"

// The report tables aren't all present in the generated DB types, so the
// builders below lean on SupabaseClient (untyped) results — matching the
// project's `as any` pattern (e.g. src/app/api/offline-sync/route.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, "public", any>

/** Hard cap on rows pulled for any single export to bound query/render cost. */
export const EXPORT_ROW_LIMIT = 2000

/** Max span (days) allowed for an export window. Guards unbounded ranges. */
export const EXPORT_MAX_RANGE_DAYS = 366

export type DateRange = { fromIso: string; toIso: string }

type BuildArgs = {
  sb: Sb
  facilityId: string
  range: DateRange
  settings: ExportSettingsRow
}

/**
 * Per-module export builder. Each implementation queries its primary
 * submission table scoped to `facilityId` + the date range, batches all
 * lookups (employees, child rows) with `.in()` to avoid N+1, and returns the
 * full superset of columns. Column visibility from
 * `settings.module_column_visibility` is applied centrally in
 * buildModuleTable.
 */
type ModuleBuilder = (args: BuildArgs) => Promise<{
  columns: Array<{ key: string; label: string }>
  rows: Array<Record<string, string>>
}>

function dateFmt(settings: ExportSettingsRow) {
  return (iso: string | null | undefined) =>
    formatExportDate(iso, settings.date_format)
}

/** Batch-load employee display names for a set of ids, facility-pinned. */
async function loadEmployeeNames(
  sb: Sb,
  facilityId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0)),
  )
  const map = new Map<string, string>()
  if (unique.length === 0) return map
  const { data } = await sb
    .from("employees")
    .select("id, first_name, last_name")
    .eq("facility_id", facilityId)
    .in("id", unique)
  for (const e of (data ?? []) as Array<{
    id: string
    first_name: string
    last_name: string
  }>) {
    map.set(e.id, `${e.first_name} ${e.last_name}`.trim())
  }
  return map
}

/** Generic single-table fetch scoped to facility + range, newest first. */
async function fetchSubmissions<T = Record<string, unknown>>(
  sb: Sb,
  table: string,
  facilityId: string,
  range: DateRange,
  columns: string,
  dateColumn = "submitted_at",
): Promise<T[]> {
  const { data } = await sb
    .from(table)
    .select(columns)
    .eq("facility_id", facilityId)
    .gte(dateColumn, range.fromIso)
    .lte(dateColumn, range.toIso)
    .order(dateColumn, { ascending: false })
    .limit(EXPORT_ROW_LIMIT)
  return (data ?? []) as T[]
}

// ---------------------------------------------------------------------------
// Per-module builders
// ---------------------------------------------------------------------------

const buildDailyReports: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    area_id: string
    template_id: string
    employee_id: string | null
    submitted_at: string
  }
  const subs = await fetchSubmissions<Row>(
    sb,
    "daily_report_submissions",
    facilityId,
    range,
    "id, area_id, template_id, employee_id, submitted_at",
  )
  const subIds = subs.map((s) => s.id)
  const [emps, areasRes, tplRes, itemsRes, notesRes] = await Promise.all([
    loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id)),
    sb.from("daily_report_areas").select("id, name").eq("facility_id", facilityId),
    sb.from("daily_report_templates").select("id, name").eq("facility_id", facilityId),
    subIds.length
      ? sb
          .from("daily_report_submission_items")
          .select("submission_id, label_snapshot, is_checked")
          .in("submission_id", subIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    subIds.length
      ? sb
          .from("daily_report_notes")
          .select("submission_id, body")
          .in("submission_id", subIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])
  const areaName = new Map(
    ((areasRes.data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name]),
  )
  const tplName = new Map(
    ((tplRes.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  )
  const itemsBySub = new Map<string, string[]>()
  for (const it of (itemsRes.data ?? []) as Array<{
    submission_id: string
    label_snapshot: string | null
    is_checked: boolean | null
  }>) {
    const label = it.label_snapshot ?? "Item"
    const val = it.is_checked ? "checked" : "unchecked"
    const arr = itemsBySub.get(it.submission_id) ?? []
    arr.push(`${label}: ${val}`)
    itemsBySub.set(it.submission_id, arr)
  }
  const notesBySub = new Map<string, string[]>()
  for (const n of (notesRes.data ?? []) as Array<{
    submission_id: string
    body: string | null
  }>) {
    if (!n.body) continue
    const arr = notesBySub.get(n.submission_id) ?? []
    arr.push(n.body)
    notesBySub.set(n.submission_id, arr)
  }

  return {
    columns: MODULE_COLUMN_OPTIONS.daily_reports,
    rows: subs.map((s) => ({
      area: areaName.get(s.area_id) ?? "",
      template: tplName.get(s.template_id) ?? "",
      submitted_by: s.employee_id ? (emps.get(s.employee_id) ?? "") : "",
      submitted_at: fmt(s.submitted_at),
      checklist_items: (itemsBySub.get(s.id) ?? []).join("; "),
      notes: (notesBySub.get(s.id) ?? []).join(" | "),
    })),
  }
}

const buildIncidentReports: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    employee_id: string | null
    incident_type_id: string | null
    severity_level_id: string | null
    location: string | null
    description: string | null
    status: string
    submitted_at: string
  }
  const subs = await fetchSubmissions<Row>(
    sb,
    "incident_reports",
    facilityId,
    range,
    "id, employee_id, incident_type_id, severity_level_id, location, description, status, submitted_at",
  )
  const [emps, typeRes, sevRes] = await Promise.all([
    loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id)),
    sb.from("incident_types").select("id, name").eq("facility_id", facilityId),
    sb
      .from("incident_severity_levels")
      .select("id, display_name")
      .eq("facility_id", facilityId),
  ])
  const typeName = new Map(
    ((typeRes.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  )
  const sevName = new Map(
    ((sevRes.data ?? []) as Array<{ id: string; display_name: string }>).map((s) => [
      s.id,
      s.display_name,
    ]),
  )
  return {
    columns: MODULE_COLUMN_OPTIONS.incident_reports,
    rows: subs.map((s) => ({
      incident_type: s.incident_type_id ? (typeName.get(s.incident_type_id) ?? "") : "",
      severity: s.severity_level_id ? (sevName.get(s.severity_level_id) ?? "") : "",
      location: s.location ?? "",
      description: s.description ?? "",
      submitted_by: s.employee_id ? (emps.get(s.employee_id) ?? "") : "",
      submitted_at: fmt(s.submitted_at),
      status: s.status,
    })),
  }
}

const buildAccidentReports: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    employee_id: string | null
    injured_person_name: string
    injured_person_contact: string
    primary_injury_type_dropdown_id: string | null
    description: string
    submitted_at: string
  }
  const subs = await fetchSubmissions<Row>(
    sb,
    "accident_reports",
    facilityId,
    range,
    "id, employee_id, injured_person_name, injured_person_contact, primary_injury_type_dropdown_id, description, submitted_at",
  )
  const subIds = subs.map((s) => s.id)
  const [emps, dropRes, partsRes, witRes] = await Promise.all([
    loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id)),
    sb.from("accident_dropdowns").select("id, display_name").eq("facility_id", facilityId),
    subIds.length
      ? sb
          .from("accident_body_part_selections")
          .select("accident_id, body_part_dropdown_id, side, laterality")
          .in("accident_id", subIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    subIds.length
      ? sb
          .from("accident_witnesses")
          .select("accident_id, name")
          .in("accident_id", subIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])
  const dropLabel = new Map(
    ((dropRes.data ?? []) as Array<{ id: string; display_name: string }>).map((d) => [
      d.id,
      d.display_name,
    ]),
  )
  const partsByReport = new Map<string, string[]>()
  for (const p of (partsRes.data ?? []) as Array<{
    accident_id: string
    body_part_dropdown_id: string
    side: string
    laterality: string | null
  }>) {
    const label = dropLabel.get(p.body_part_dropdown_id)
    if (!label) continue
    const latPrefix =
      p.laterality === "left"
        ? "Left "
        : p.laterality === "right"
          ? "Right "
          : ""
    const full = `${latPrefix}${label}`
    const display = p.side && p.side !== "none" ? `${full} (${p.side})` : full
    const arr = partsByReport.get(p.accident_id) ?? []
    arr.push(display)
    partsByReport.set(p.accident_id, arr)
  }
  const witByReport = new Map<string, string[]>()
  for (const w of (witRes.data ?? []) as Array<{
    accident_id: string
    name: string | null
  }>) {
    if (!w.name) continue
    const arr = witByReport.get(w.accident_id) ?? []
    arr.push(w.name)
    witByReport.set(w.accident_id, arr)
  }
  return {
    columns: MODULE_COLUMN_OPTIONS.accident_reports,
    rows: subs.map((s) => ({
      injured_person: s.injured_person_name,
      body_parts: (partsByReport.get(s.id) ?? []).join(", "),
      nature_of_injury: s.primary_injury_type_dropdown_id
        ? (dropLabel.get(s.primary_injury_type_dropdown_id) ?? "")
        : "",
      description: s.description,
      witnesses: (witByReport.get(s.id) ?? []).join(", "),
      submitted_by: s.employee_id ? (emps.get(s.employee_id) ?? "") : "",
      submitted_at: fmt(s.submitted_at),
    })),
  }
}

const buildRefrigeration: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = { id: string; employee_id: string | null; submitted_at: string }
  const subs = await fetchSubmissions<Row>(
    sb,
    "refrigeration_reports",
    facilityId,
    range,
    "id, employee_id, submitted_at",
  )
  const subIds = subs.map((s) => s.id)
  const [emps, valsRes] = await Promise.all([
    loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id)),
    subIds.length
      ? sb
          .from("refrigeration_report_values")
          .select(
            "report_id, label_snapshot, equipment_name_snapshot, unit_snapshot, value_text, value_numeric, value_boolean, is_out_of_range",
          )
          .in("report_id", subIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])
  type Val = {
    report_id: string
    label_snapshot: string
    equipment_name_snapshot: string | null
    unit_snapshot: string | null
    value_text: string | null
    value_numeric: number | null
    value_boolean: boolean | null
    is_out_of_range: boolean
  }
  const readingsByReport = new Map<string, string[]>()
  const equipByReport = new Map<string, Set<string>>()
  const alertsByReport = new Map<string, string[]>()
  for (const v of (valsRes.data ?? []) as Val[]) {
    let display: string
    if (v.value_numeric != null) display = `${v.value_numeric}${v.unit_snapshot ?? ""}`
    else if (v.value_boolean != null) display = v.value_boolean ? "Yes" : "No"
    else display = v.value_text ?? ""
    const eq = v.equipment_name_snapshot
    const prefix = eq ? `${eq} ${v.label_snapshot}` : v.label_snapshot
    const arr = readingsByReport.get(v.report_id) ?? []
    arr.push(`${prefix}: ${display}`)
    readingsByReport.set(v.report_id, arr)
    if (eq) {
      const set = equipByReport.get(v.report_id) ?? new Set<string>()
      set.add(eq)
      equipByReport.set(v.report_id, set)
    }
    if (v.is_out_of_range) {
      const al = alertsByReport.get(v.report_id) ?? []
      al.push(prefix)
      alertsByReport.set(v.report_id, al)
    }
  }
  // refrigeration_report_values carries no section snapshot; we surface the
  // equipment grouping (the closest available signal) and leave the dedicated
  // "Section" column empty rather than running an extra per-row join.
  return {
    columns: MODULE_COLUMN_OPTIONS.refrigeration,
    rows: subs.map((s) => ({
      section: "",
      equipment: Array.from(equipByReport.get(s.id) ?? []).join(", "),
      readings: (readingsByReport.get(s.id) ?? []).join("; "),
      thresholds_exceeded: (alertsByReport.get(s.id) ?? []).join(", "),
      submitted_by: s.employee_id ? (emps.get(s.employee_id) ?? "") : "",
      submitted_at: fmt(s.submitted_at),
    })),
  }
}

const buildAirQuality: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    employee_id: string | null
    location_id: string
    has_exceedance: boolean
    submitted_at: string
  }
  const subs = await fetchSubmissions<Row>(
    sb,
    "air_quality_reports",
    facilityId,
    range,
    "id, employee_id, location_id, has_exceedance, submitted_at",
  )
  const subIds = subs.map((s) => s.id)
  const [emps, locRes, readRes] = await Promise.all([
    loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id)),
    sb.from("air_quality_locations").select("id, name").eq("facility_id", facilityId),
    subIds.length
      ? sb
          .from("air_quality_readings")
          .select("report_id, label_snapshot, unit_snapshot, value_numeric, is_exceedance")
          .in("report_id", subIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])
  const locName = new Map(
    ((locRes.data ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name]),
  )
  const readingsByReport = new Map<string, string[]>()
  const alertsByReport = new Map<string, string[]>()
  for (const r of (readRes.data ?? []) as Array<{
    report_id: string
    label_snapshot: string
    unit_snapshot: string
    value_numeric: number
    is_exceedance: boolean
  }>) {
    const arr = readingsByReport.get(r.report_id) ?? []
    arr.push(`${r.label_snapshot}: ${r.value_numeric}${r.unit_snapshot}`)
    readingsByReport.set(r.report_id, arr)
    if (r.is_exceedance) {
      const al = alertsByReport.get(r.report_id) ?? []
      al.push(r.label_snapshot)
      alertsByReport.set(r.report_id, al)
    }
  }
  return {
    columns: MODULE_COLUMN_OPTIONS.air_quality,
    rows: subs.map((s) => ({
      location: locName.get(s.location_id) ?? "",
      readings: (readingsByReport.get(s.id) ?? []).join("; "),
      thresholds_exceeded: (alertsByReport.get(s.id) ?? []).join(", "),
      submitted_by: s.employee_id ? (emps.get(s.employee_id) ?? "") : "",
      submitted_at: fmt(s.submitted_at),
    })),
  }
}

const buildIceDepth: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    employee_id: string | null
    layout_id: string
    submitted_at: string
  }
  const subs = await fetchSubmissions<Row>(
    sb,
    "ice_depth_sessions",
    facilityId,
    range,
    "id, employee_id, layout_id, submitted_at",
  )
  const subIds = subs.map((s) => s.id)
  const [emps, layoutRes, measRes] = await Promise.all([
    loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id)),
    sb.from("ice_depth_layouts").select("id, name").eq("facility_id", facilityId),
    subIds.length
      ? sb
          .from("ice_depth_measurements")
          .select("session_id, point_number_snapshot, label_snapshot, depth_value")
          .in("session_id", subIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])
  const layoutName = new Map(
    ((layoutRes.data ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name]),
  )
  type Meas = {
    session_id: string
    point_number_snapshot: number
    label_snapshot: string | null
    depth_value: number
  }
  const cellsBySession = new Map<string, string[]>()
  const depthsBySession = new Map<string, number[]>()
  for (const m of (measRes.data ?? []) as Meas[]) {
    const cells = cellsBySession.get(m.session_id) ?? []
    const label = m.label_snapshot ?? `#${m.point_number_snapshot}`
    cells.push(`${label}: ${m.depth_value}`)
    cellsBySession.set(m.session_id, cells)
    const depths = depthsBySession.get(m.session_id) ?? []
    depths.push(m.depth_value)
    depthsBySession.set(m.session_id, depths)
  }
  const stat = (id: string, kind: "min" | "max" | "avg"): string => {
    const ds = depthsBySession.get(id) ?? []
    if (ds.length === 0) return ""
    if (kind === "min") return String(Math.min(...ds))
    if (kind === "max") return String(Math.max(...ds))
    const avg = ds.reduce((a, b) => a + b, 0) / ds.length
    return avg.toFixed(2)
  }
  return {
    columns: MODULE_COLUMN_OPTIONS.ice_depth,
    rows: subs.map((s) => ({
      layout: layoutName.get(s.layout_id) ?? "",
      cell_readings: (cellsBySession.get(s.id) ?? []).join("; "),
      min_depth: stat(s.id, "min"),
      max_depth: stat(s.id, "max"),
      avg_depth: stat(s.id, "avg"),
      submitted_by: s.employee_id ? (emps.get(s.employee_id) ?? "") : "",
      submitted_at: fmt(s.submitted_at),
    })),
  }
}

const ICE_OPERATION_LABELS: Record<string, string> = {
  ice_make: "Ice Make",
  circle_check: "Circle Check",
  edging: "Edging",
  blade_change: "Blade Change",
}

const buildIceOperations: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    employee_id: string | null
    operation_type: string
    occurred_at: string
    payload: Record<string, unknown> | null
    notes: string | null
    submitted_at: string
  }
  const subs = await fetchSubmissions<Row>(
    sb,
    "ice_operations_submissions",
    facilityId,
    range,
    "id, employee_id, operation_type, occurred_at, payload, notes, submitted_at",
  )
  const emps = await loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id))
  const durationFromPayload = (
    op: string,
    payload: Record<string, unknown> | null,
  ): string => {
    if (!payload) return ""
    if (op === "ice_make") {
      const tin = payload.time_in as string | undefined
      const tout = payload.time_out as string | undefined
      if (tin && tout) return `${tin}–${tout}`
    }
    if (op === "edging" && payload.hours_run != null) return `${payload.hours_run} h`
    return ""
  }
  return {
    columns: MODULE_COLUMN_OPTIONS.ice_operations,
    rows: subs.map((s) => ({
      operation_type: ICE_OPERATION_LABELS[s.operation_type] ?? s.operation_type,
      duration: durationFromPayload(s.operation_type, s.payload),
      notes: s.notes ?? "",
      submitted_by: s.employee_id ? (emps.get(s.employee_id) ?? "") : "",
      submitted_at: fmt(s.submitted_at),
    })),
  }
}

// Communications and scheduling have no entry in MODULE_COLUMN_OPTIONS, so we
// define sensible default column sets inline (degrade to the primary table per
// task guidance rather than crashing).

const COMMUNICATIONS_COLUMNS = [
  { key: "subject", label: "Subject" },
  { key: "body", label: "Message" },
  { key: "requires_ack", label: "Requires acknowledgement" },
  { key: "sender", label: "Sender" },
  { key: "sent_at", label: "Sent at" },
]

const buildCommunications: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    sender_employee_id: string | null
    subject: string | null
    body: string
    requires_acknowledgement: boolean
    sent_at: string
  }
  const subs = await fetchSubmissions<Row>(
    sb,
    "communication_messages",
    facilityId,
    range,
    "id, sender_employee_id, subject, body, requires_acknowledgement, sent_at",
    "sent_at",
  )
  const emps = await loadEmployeeNames(sb, facilityId, subs.map((s) => s.sender_employee_id))
  return {
    columns: COMMUNICATIONS_COLUMNS,
    rows: subs.map((s) => ({
      subject: s.subject ?? "",
      body: s.body,
      requires_ack: s.requires_acknowledgement ? "Yes" : "No",
      sender: s.sender_employee_id ? (emps.get(s.sender_employee_id) ?? "") : "",
      sent_at: fmt(s.sent_at),
    })),
  }
}

const SCHEDULING_COLUMNS = [
  { key: "employee", label: "Employee" },
  { key: "role_label", label: "Role" },
  { key: "starts_at", label: "Starts" },
  { key: "ends_at", label: "Ends" },
  { key: "break_minutes", label: "Break (min)" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
]

const buildScheduling: ModuleBuilder = async ({ sb, facilityId, range, settings }) => {
  const fmt = dateFmt(settings)
  type Row = {
    id: string
    employee_id: string | null
    role_label: string | null
    starts_at: string
    ends_at: string
    break_minutes: number | null
    status: string
    notes: string | null
  }
  // Scheduling rows are keyed by starts_at, not submitted_at.
  const subs = await fetchSubmissions<Row>(
    sb,
    "schedule_shifts",
    facilityId,
    range,
    "id, employee_id, role_label, starts_at, ends_at, break_minutes, status, notes",
    "starts_at",
  )
  const emps = await loadEmployeeNames(sb, facilityId, subs.map((s) => s.employee_id))
  return {
    columns: SCHEDULING_COLUMNS,
    rows: subs.map((s) => ({
      employee: s.employee_id ? (emps.get(s.employee_id) ?? "") : "(open shift)",
      role_label: s.role_label ?? "",
      starts_at: fmt(s.starts_at),
      ends_at: fmt(s.ends_at),
      break_minutes: s.break_minutes == null ? "" : String(s.break_minutes),
      status: s.status,
      notes: s.notes ?? "",
    })),
  }
}

const BUILDERS: Record<string, ModuleBuilder> = {
  daily_reports: buildDailyReports,
  incident_reports: buildIncidentReports,
  accident_reports: buildAccidentReports,
  refrigeration: buildRefrigeration,
  air_quality: buildAirQuality,
  ice_depth: buildIceDepth,
  ice_operations: buildIceOperations,
  communications: buildCommunications,
  scheduling: buildScheduling,
}

/**
 * Modules with an exportable submission table. 'admin' has no submissions and
 * is intentionally excluded (matches the task scope).
 */
export const EXPORTABLE_MODULES: ModuleName[] = MODULE_NAMES.filter(
  (m): m is ModuleName => m !== "admin" && m in BUILDERS,
)

export function isExportableModule(module: string): module is ModuleName {
  return module in BUILDERS
}

export function moduleTitle(module: string): string {
  return (
    (MODULE_LABELS as Record<string, string>)[module] ??
    module.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

/**
 * Build an ExportTable for a module + facility + date range, applying the
 * facility's saved per-module column visibility. Always scoped to
 * `facilityId`; never reads cross-facility data. Returns null for an unknown
 * module.
 */
export async function buildModuleTable(
  args: BuildArgs & { module: string },
): Promise<ExportTable | null> {
  const builder = BUILDERS[args.module]
  if (!builder) return null
  const { columns, rows } = await builder(args)

  // Apply saved visibility. An absent/empty entry means "all columns".
  const saved = args.settings.module_column_visibility?.[args.module]
  const visibleKeys =
    Array.isArray(saved) && saved.length > 0
      ? new Set(saved)
      : new Set(columns.map((c) => c.key))
  const visibleColumns = columns.filter((c) => visibleKeys.has(c.key))
  // Guard against a visibility map that hid every known column.
  const cols = visibleColumns.length > 0 ? visibleColumns : columns

  return {
    module: args.module,
    title: moduleTitle(args.module),
    headers: cols.map((c) => c.label),
    rows: rows.map((r) => cols.map((c) => r[c.key] ?? "")),
  }
}
