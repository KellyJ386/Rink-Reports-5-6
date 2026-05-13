import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * A flat, source-module-agnostic representation of a submission that's
 * enough to render a useful PDF. Each fetcher in this module reads one
 * specific module's table(s), joins the obvious lookups, and returns this
 * shape — so the React-PDF template doesn't need per-module branching.
 */
export type SubmissionSnapshot = {
  facility_id: string
  source_module: string
  source_record_id: string
  title: string
  subtitle: string | null
  submitted_at: string | null
  fields: Array<{ label: string; value: string | null }>
  long_form: { label: string; body: string } | null
}

type Sb = SupabaseClient

async function fetchEmployeeName(sb: Sb, employeeId: string | null) {
  if (!employeeId) return null
  const { data } = await sb
    .from("employees")
    .select("first_name, last_name")
    .eq("id", employeeId)
    .maybeSingle()
  if (!data) return null
  return `${data.first_name} ${data.last_name}`
}

async function snapshotIncident(sb: Sb, recordId: string): Promise<SubmissionSnapshot | null> {
  const { data: r } = await sb
    .from("incident_reports")
    .select(
      "id, facility_id, employee_id, location, occurred_at, reporter_name, reporter_phone, description, status, submitted_at, severity_level_id, incident_type_id",
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!r) return null

  const submitter = await fetchEmployeeName(sb, r.employee_id)
  return {
    facility_id: r.facility_id,
    source_module: "incident_reports",
    source_record_id: r.id,
    title: "Incident Report",
    subtitle: r.location ?? null,
    submitted_at: r.submitted_at,
    fields: [
      { label: "Occurred at", value: r.occurred_at },
      { label: "Reporter", value: r.reporter_name },
      { label: "Reporter phone", value: r.reporter_phone },
      { label: "Submitter", value: submitter },
      { label: "Status", value: r.status },
    ],
    long_form: { label: "Description", body: r.description ?? "" },
  }
}

async function snapshotAccident(sb: Sb, recordId: string): Promise<SubmissionSnapshot | null> {
  const { data: r } = await sb
    .from("accident_reports")
    .select(
      "id, facility_id, employee_id, injured_person_name, injured_person_contact, description, occurred_at, submitted_at, workers_comp",
    )
    .eq("id", recordId)
    .maybeSingle()
  if (!r) return null
  const submitter = await fetchEmployeeName(sb, r.employee_id)
  return {
    facility_id: r.facility_id,
    source_module: "accident_reports",
    source_record_id: r.id,
    title: "Accident Report",
    subtitle: r.injured_person_name,
    submitted_at: r.submitted_at,
    fields: [
      { label: "Occurred at", value: r.occurred_at },
      { label: "Injured person", value: r.injured_person_name },
      { label: "Contact", value: r.injured_person_contact },
      { label: "Submitter", value: submitter },
      { label: "Workers' comp", value: r.workers_comp ? "Yes" : "No" },
    ],
    long_form: { label: "Description", body: r.description ?? "" },
  }
}

async function snapshotDaily(sb: Sb, recordId: string): Promise<SubmissionSnapshot | null> {
  const { data: r } = await sb
    .from("daily_report_submissions")
    .select("id, facility_id, employee_id, area_id, submitted_at")
    .eq("id", recordId)
    .maybeSingle()
  if (!r) return null
  const submitter = await fetchEmployeeName(sb, r.employee_id)
  return {
    facility_id: r.facility_id,
    source_module: "daily_reports",
    source_record_id: r.id,
    title: "Daily Report",
    subtitle: null,
    submitted_at: r.submitted_at ?? null,
    fields: [
      { label: "Area", value: r.area_id },
      { label: "Submitter", value: submitter },
    ],
    long_form: null,
  }
}

async function snapshotRefrigeration(sb: Sb, recordId: string): Promise<SubmissionSnapshot | null> {
  const { data: r } = await sb
    .from("refrigeration_reports")
    .select("id, facility_id, employee_id, submitted_at, notes")
    .eq("id", recordId)
    .maybeSingle()
  if (!r) return null
  const submitter = await fetchEmployeeName(sb, r.employee_id)
  return {
    facility_id: r.facility_id,
    source_module: "refrigeration",
    source_record_id: r.id,
    title: "Refrigeration Report",
    subtitle: null,
    submitted_at: r.submitted_at,
    fields: [{ label: "Submitter", value: submitter }],
    long_form: r.notes ? { label: "Notes", body: r.notes } : null,
  }
}

async function snapshotAirQuality(sb: Sb, recordId: string): Promise<SubmissionSnapshot | null> {
  const { data: r } = await sb
    .from("air_quality_reports")
    .select("id, facility_id, employee_id, submitted_at, notes")
    .eq("id", recordId)
    .maybeSingle()
  if (!r) return null
  const submitter = await fetchEmployeeName(sb, r.employee_id)
  return {
    facility_id: r.facility_id,
    source_module: "air_quality",
    source_record_id: r.id,
    title: "Air Quality Report",
    subtitle: null,
    submitted_at: r.submitted_at,
    fields: [{ label: "Submitter", value: submitter }],
    long_form: r.notes ? { label: "Notes", body: r.notes } : null,
  }
}

async function snapshotIceDepth(sb: Sb, recordId: string): Promise<SubmissionSnapshot | null> {
  const { data: r } = await sb
    .from("ice_depth_sessions")
    .select("id, facility_id, employee_id, submitted_at, layout_id, notes")
    .eq("id", recordId)
    .maybeSingle()
  if (!r) return null
  const submitter = await fetchEmployeeName(sb, r.employee_id)
  return {
    facility_id: r.facility_id,
    source_module: "ice_depth",
    source_record_id: r.id,
    title: "Ice Depth Session",
    subtitle: null,
    submitted_at: r.submitted_at,
    fields: [
      { label: "Submitter", value: submitter },
      { label: "Layout", value: r.layout_id },
    ],
    long_form: r.notes ? { label: "Notes", body: r.notes } : null,
  }
}

const REGISTRY: Record<
  string,
  ((sb: Sb, recordId: string) => Promise<SubmissionSnapshot | null>) | undefined
> = {
  incident_reports: snapshotIncident,
  accident_reports: snapshotAccident,
  daily_reports: snapshotDaily,
  refrigeration: snapshotRefrigeration,
  air_quality: snapshotAirQuality,
  ice_depth: snapshotIceDepth,
}

/**
 * Fetch the per-module snapshot needed by the PDF template. Returns null
 * when the source row was deleted between dispatch and drain, or when no
 * snapshot fetcher is registered for the module (in which case the cron
 * route should skip rendering and leave pdf_url null).
 */
export async function fetchSubmissionSnapshot(
  sb: Sb,
  sourceModule: string,
  sourceRecordId: string,
): Promise<SubmissionSnapshot | null> {
  // generated types haven't kept up with all the report tables, so the
  // fetchers above use `as any` implicitly by virtue of SupabaseClient<any>.
  const fn = REGISTRY[sourceModule]
  if (!fn) return null
  try {
    return await fn(sb, sourceRecordId)
  } catch (e) {
    console.error(
      `[notifications/pdf] snapshot ${sourceModule}/${sourceRecordId} failed:`,
      e,
    )
    return null
  }
}
