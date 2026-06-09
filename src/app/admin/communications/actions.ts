"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import type { Database, Json } from "@/types/database"

import type { ActionState, Severity, SimpleResult } from "./types"
import { isSeverity } from "./types"

type SupabaseError = { code?: string; message?: string } | null
type SupabaseClient = Awaited<ReturnType<typeof createClient>>

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ROLE_KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function asInt(value: FormDataEntryValue | null): number | null {
  const s = nonEmpty(value)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  if (err.code === "23503") {
    return "Cannot complete: a related record prevents this change."
  }
  if (err.code === "P0001") {
    return err.message?.trim() || fallback
  }
  return err.message?.trim() || fallback
}

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  return { ok: true, facilityId: profile.facility_id }
}

/**
 * Look up the actor employee_id for the current user in this facility, or
 * return null if no matching active employee row exists (e.g. super_admins
 * acting cross-facility may not have one). The audit log column is nullable
 * so it's safe to write null.
 */
async function resolveActorEmployeeId(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<string | null> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile?.id) return null
  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", profile.id)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .maybeSingle()
  return data?.id ?? null
}

type AuditPayload = {
  entity_type: string
  entity_id: string | null
  action: string
  before?: Json | null
  after?: Json | null
}

/**
 * Append-only audit writer. Best-effort: a failure to write the audit row
 * MUST NOT roll back the primary mutation, so we just swallow audit errors.
 * Callers pass the already-resolved facility id and actor employee id to
 * avoid duplicate lookups.
 */
async function writeAudit(
  supabase: SupabaseClient,
  facilityId: string,
  actorEmployeeId: string | null,
  payload: AuditPayload,
): Promise<void> {
  await supabase.from("communication_audit_log").insert({
    facility_id: facilityId,
    actor_employee_id: actorEmployeeId,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    action: payload.action,
    before: payload.before ?? null,
    after: payload.after ?? null,
  })
}

function revalidate(): void {
  revalidatePath("/admin/communications")
}

// ============================================================================
// Templates
// ============================================================================

export async function createTemplate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }

    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }
    const category = nonEmpty(formData.get("category"))
    const subject = nonEmpty(formData.get("subject"))
    const body = nonEmpty(formData.get("body"))
    if (!body) return { ok: false, error: "Body is required." }
    const requires_acknowledgement =
      formData.get("requires_acknowledgement") === "on"
    const is_active = formData.get("is_active") !== "off"

    const supabase = await createClient()
    const insert: Database["public"]["Tables"]["communication_templates"]["Insert"] =
      {
        facility_id: facility.facilityId,
        name,
        slug,
        category,
        subject,
        body,
        requires_acknowledgement,
        is_active,
      }
    const { data, error } = await supabase
      .from("communication_templates")
      .insert(insert)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create template.") }
    }

    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_template",
      entity_id: data.id,
      action: "create",
      after: data as unknown as Json,
    })

    revalidate()
    return { ok: true, message: "Template created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateTemplate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing template id." }
    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }
    const category = nonEmpty(formData.get("category"))
    const subject = nonEmpty(formData.get("subject"))
    const body = nonEmpty(formData.get("body"))
    if (!body) return { ok: false, error: "Body is required." }
    const requires_acknowledgement =
      formData.get("requires_acknowledgement") === "on"

    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_templates")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()

    const { data, error } = await supabase
      .from("communication_templates")
      .update({
        name,
        slug,
        category,
        subject,
        body,
        requires_acknowledgement,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update template.") }
    }

    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_template",
      entity_id: id,
      action: "update",
      before: (before ?? null) as unknown as Json,
      after: data as unknown as Json,
    })

    revalidate()
    return { ok: true, message: "Template updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setTemplateActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_templates")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update template.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_template",
      entity_id: id,
      action: is_active ? "activate" : "deactivate",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteTemplate(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing template id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_templates")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { error } = await supabase
      .from("communication_templates")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        const { count } = await supabase
          .from("communication_recurring_reminders")
          .select("id", { count: "exact", head: true })
          .eq("template_id", id)
        const n = count ?? 0
        return {
          ok: false,
          error: `Template in use by ${n} reminder${n === 1 ? "" : "s"}; deactivate instead.`,
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete template.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_template",
      entity_id: id,
      action: "delete",
      before: (before ?? null) as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Groups
// ============================================================================

export async function createGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }
    const description = nonEmpty(formData.get("description"))
    const sort_order = asInt(formData.get("sort_order")) ?? 0
    const staff_can_message = formData.get("staff_can_message") === "on"
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_groups")
      .insert({
        facility_id: facility.facilityId,
        name,
        slug,
        description,
        sort_order,
        staff_can_message,
      })
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create group.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_group",
      entity_id: data.id,
      action: "create",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true, message: "Group created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing group id." }
    const name = nonEmpty(formData.get("name"))
    if (!name) return { ok: false, error: "Name is required." }
    const rawSlug = nonEmpty(formData.get("slug"))
    const slug = rawSlug ?? slugify(name)
    if (!SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits, and hyphens.",
      }
    }
    const description = nonEmpty(formData.get("description"))
    const sort_order = asInt(formData.get("sort_order"))
    const staffCanMessageRaw = formData.get("staff_can_message")
    const staff_can_message =
      staffCanMessageRaw === null ? null : staffCanMessageRaw === "on"
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_groups")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { data, error } = await supabase
      .from("communication_groups")
      .update({
        name,
        slug,
        description,
        ...(sort_order !== null ? { sort_order } : {}),
        ...(staff_can_message !== null ? { staff_can_message } : {}),
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update group.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_group",
      entity_id: id,
      action: "update",
      before: (before ?? null) as unknown as Json,
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true, message: "Group updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setGroupActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing group id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_groups")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update group.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_group",
      entity_id: id,
      action: is_active ? "activate" : "deactivate",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteGroup(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing group id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_groups")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { error } = await supabase
      .from("communication_groups")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "Group is referenced by routing rules or reminders; deactivate instead.",
        }
      }
      return { ok: false, error: dbError(error, "Failed to delete group.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_group",
      entity_id: id,
      action: "delete",
      before: (before ?? null) as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function addGroupMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const group_id = nonEmpty(formData.get("group_id"))
    if (!group_id) return { ok: false, error: "Missing group id." }
    const employee_id = nonEmpty(formData.get("employee_id"))
    if (!employee_id) return { ok: false, error: "Pick an employee." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_group_members")
      .insert({
        facility_id: facility.facilityId,
        group_id,
        employee_id,
      })
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to add member.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_group_member",
      entity_id: data.id,
      action: "create",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true, message: "Member added." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function removeGroupMember(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing member id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_group_members")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { error } = await supabase
      .from("communication_group_members")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to remove member.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_group_member",
      entity_id: id,
      action: "delete",
      before: (before ?? null) as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Routing rules
// ============================================================================

type TargetKind = "group" | "role" | "employee" | "department"

function isTargetKind(v: string): v is TargetKind {
  return v === "group" || v === "role" || v === "employee" || v === "department"
}

const ALLOWED_TIMINGS = ["immediate", "end_of_day", "weekly", "manual"] as const
type Timing = (typeof ALLOWED_TIMINGS)[number]
function isTiming(s: string): s is Timing {
  return (ALLOWED_TIMINGS as readonly string[]).includes(s)
}

function parseRoutingForm(formData: FormData): {
  ok: true
  data: {
    name: string | null
    source_module: string
    severity: Severity | null
    area_id: string | null
    target_group_id: string | null
    target_role_key: string | null
    target_employee_id: string | null
    target_department_id: string | null
    timing: Timing
    attach_pdf: boolean
    requires_acknowledgement: boolean
    priority: number
    is_active: boolean
  }
} | { ok: false; error: string } {
  const source_module = nonEmpty(formData.get("source_module"))
  if (!source_module)
    return { ok: false, error: "Source module is required." }

  const sevRaw = nonEmpty(formData.get("severity"))
  let severity: Severity | null = null
  if (sevRaw && sevRaw !== "any") {
    if (!isSeverity(sevRaw)) return { ok: false, error: "Invalid severity." }
    severity = sevRaw
  }

  const area_id = nonEmpty(formData.get("area_id"))
  if (area_id && !UUID_RE.test(area_id)) {
    return {
      ok: false,
      error: "Area ID must be a valid UUID, or leave it blank.",
    }
  }

  const targetKindRaw = nonEmpty(formData.get("target_kind")) ?? ""
  if (!isTargetKind(targetKindRaw)) {
    return { ok: false, error: "Pick a target type (group, role, or employee)." }
  }
  let target_group_id: string | null = null
  let target_role_key: string | null = null
  let target_employee_id: string | null = null
  let target_department_id: string | null = null
  if (targetKindRaw === "group") {
    target_group_id = nonEmpty(formData.get("target_group_id"))
    if (!target_group_id)
      return { ok: false, error: "Pick a target group." }
  } else if (targetKindRaw === "role") {
    target_role_key = nonEmpty(formData.get("target_role_key"))
    if (!target_role_key)
      return { ok: false, error: "Pick a target role." }
    if (!ROLE_KEY_RE.test(target_role_key))
      return { ok: false, error: "Invalid role key." }
  } else if (targetKindRaw === "department") {
    target_department_id = nonEmpty(formData.get("target_department_id"))
    if (!target_department_id)
      return { ok: false, error: "Pick a target department." }
    if (!UUID_RE.test(target_department_id))
      return { ok: false, error: "Invalid department id." }
  } else {
    target_employee_id = nonEmpty(formData.get("target_employee_id"))
    if (!target_employee_id)
      return { ok: false, error: "Pick a target employee." }
  }

  const priority = asInt(formData.get("priority")) ?? 0
  const is_active = formData.get("is_active") !== "off"
  const name = nonEmpty(formData.get("name"))

  const timingRaw = nonEmpty(formData.get("timing")) ?? "immediate"
  if (!isTiming(timingRaw)) {
    return { ok: false, error: "Invalid timing value." }
  }
  const attach_pdf = formData.get("attach_pdf") === "on"
  const requires_acknowledgement =
    formData.get("requires_acknowledgement") === "on"

  return {
    ok: true,
    data: {
      name,
      source_module,
      severity,
      area_id,
      target_group_id,
      target_role_key,
      target_employee_id,
      target_department_id,
      timing: timingRaw,
      attach_pdf,
      requires_acknowledgement,
      priority,
      is_active,
    },
  }
}

export async function createRoutingRule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const parsed = parseRoutingForm(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_routing_rules")
      .insert({ facility_id: facility.facilityId, ...parsed.data })
      .select("*")
      .single()
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to create routing rule."),
      }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_routing_rule",
      entity_id: data.id,
      action: "create",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true, message: "Routing rule created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateRoutingRule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing rule id." }
    const parsed = parseRoutingForm(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_routing_rules")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { data, error } = await supabase
      .from("communication_routing_rules")
      .update(parsed.data)
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update routing rule."),
      }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_routing_rule",
      entity_id: id,
      action: "update",
      before: (before ?? null) as unknown as Json,
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true, message: "Routing rule updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setRoutingRuleActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_routing_rules")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to update routing rule."),
      }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_routing_rule",
      entity_id: id,
      action: is_active ? "activate" : "deactivate",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteRoutingRule(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_routing_rules")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { error } = await supabase
      .from("communication_routing_rules")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return {
        ok: false,
        error: dbError(error, "Failed to delete routing rule."),
      }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_routing_rule",
      entity_id: id,
      action: "delete",
      before: (before ?? null) as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

/**
 * Preview the resolved recipient set for a single routing rule. Returns the
 * matching employees so the admin can sanity-check a rule before saving it.
 */
export async function previewRoutingRecipients(ruleId: string): Promise<
  | { ok: true; recipients: Array<{ id: string; first_name: string; last_name: string; email: string | null }> }
  | { ok: false; error: string }
> {
  try {
    await requireAdmin()
    if (!ruleId) return { ok: false, error: "Missing rule id." }
    const supabase = await createClient()
    const { data: ids, error } = await supabase.rpc(
      "resolve_rule_recipients",
      { p_rule_id: ruleId },
    )
    if (error) return { ok: false, error: error.message }
    const employeeIds = (ids ?? []).map((r) => r.employee_id)
    if (employeeIds.length === 0) return { ok: true, recipients: [] }

    const { data: emps, error: empErr } = await supabase
      .from("employees")
      .select("id, first_name, last_name, email")
      .in("id", employeeIds)
    if (empErr) return { ok: false, error: empErr.message }
    return { ok: true, recipients: emps ?? [] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Reminders
// ============================================================================

function parseReminderForm(formData: FormData): {
  ok: true
  data: {
    name: string
    schedule_cron: string
    template_id: string
    target_group_id: string | null
    target_role_key: string | null
    next_run_at: string | null
    is_active: boolean
  }
} | { ok: false; error: string } {
  const name = nonEmpty(formData.get("name"))
  if (!name) return { ok: false, error: "Name is required." }
  const schedule_cron = nonEmpty(formData.get("schedule_cron"))
  if (!schedule_cron)
    return { ok: false, error: "Schedule (cron) is required." }
  const cronParts = schedule_cron.split(/\s+/)
  if (cronParts.length !== 5) {
    return {
      ok: false,
      error: "Cron must have 5 fields, e.g. '0 8 * * 1'.",
    }
  }
  // Validate each cron field: only allow digits, *, -, /, and commas.
  if (cronParts.some((p) => !/^[\d*/,\-]+$/.test(p))) {
    return {
      ok: false,
      error: "Cron fields may only contain digits, *, -, /, and commas.",
    }
  }
  const template_id = nonEmpty(formData.get("template_id"))
  if (!template_id) return { ok: false, error: "Pick a template." }

  const targetKindRaw = nonEmpty(formData.get("target_kind")) ?? ""
  let target_group_id: string | null = null
  let target_role_key: string | null = null
  if (targetKindRaw === "group") {
    target_group_id = nonEmpty(formData.get("target_group_id"))
    if (!target_group_id)
      return { ok: false, error: "Pick a target group." }
  } else if (targetKindRaw === "role") {
    target_role_key = nonEmpty(formData.get("target_role_key"))
    if (!target_role_key) return { ok: false, error: "Pick a target role." }
    if (!ROLE_KEY_RE.test(target_role_key))
      return { ok: false, error: "Invalid role key." }
  } else {
    return { ok: false, error: "Pick a target type (group or role)." }
  }
  const next_run_raw = nonEmpty(formData.get("next_run_at"))
  let next_run_at: string | null = null
  if (next_run_raw) {
    const d = new Date(next_run_raw)
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "Next run timestamp is invalid." }
    }
    next_run_at = d.toISOString()
  }
  const is_active = formData.get("is_active") !== "off"
  return {
    ok: true,
    data: {
      name,
      schedule_cron,
      template_id,
      target_group_id,
      target_role_key,
      next_run_at,
      is_active,
    },
  }
}

export async function createReminder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const parsed = parseReminderForm(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_recurring_reminders")
      .insert({ facility_id: facility.facilityId, ...parsed.data })
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to create reminder.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_recurring_reminder",
      entity_id: data.id,
      action: "create",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true, message: "Reminder created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateReminder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing reminder id." }
    const parsed = parseReminderForm(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_recurring_reminders")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { data, error } = await supabase
      .from("communication_recurring_reminders")
      .update(parsed.data)
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update reminder.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_recurring_reminder",
      entity_id: id,
      action: "update",
      before: (before ?? null) as unknown as Json,
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true, message: "Reminder updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function setReminderActive(
  id: string,
  is_active: boolean,
): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing reminder id." }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("communication_recurring_reminders")
      .update({ is_active })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to update reminder.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_recurring_reminder",
      entity_id: id,
      action: is_active ? "activate" : "deactivate",
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteReminder(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing reminder id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_recurring_reminders")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { error } = await supabase
      .from("communication_recurring_reminders")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete reminder.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_recurring_reminder",
      entity_id: id,
      action: "delete",
      before: (before ?? null) as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Alerts
// ============================================================================

export async function resolveAlert(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing alert id." }
    const supabase = await createClient()
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    const { data: before } = await supabase
      .from("communication_alerts")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { data, error } = await supabase
      .from("communication_alerts")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by_employee_id: actor,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to resolve alert.") }
    }
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_alert",
      entity_id: id,
      action: "resolve",
      before: (before ?? null) as unknown as Json,
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function reopenAlert(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing alert id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_alerts")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { data, error } = await supabase
      .from("communication_alerts")
      .update({
        resolved_at: null,
        resolved_by_employee_id: null,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .select("*")
      .single()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to re-open alert.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_alert",
      entity_id: id,
      action: "reopen",
      before: (before ?? null) as unknown as Json,
      after: data as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteAlert(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing alert id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_alerts")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { error } = await supabase
      .from("communication_alerts")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      // RLS will block non-super-admin with permission denied.
      return { ok: false, error: dbError(error, "Failed to delete alert.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_alert",
      entity_id: id,
      action: "delete",
      before: (before ?? null) as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Messages (super-admin only delete; staff send via reports module).
// ============================================================================

export async function deleteMessage(id: string): Promise<SimpleResult> {
  try {
    await requireAdmin()
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!id) return { ok: false, error: "Missing message id." }
    const supabase = await createClient()
    const { data: before } = await supabase
      .from("communication_messages")
      .select("*")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()
    const { error } = await supabase
      .from("communication_messages")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete message.") }
    }
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_message",
      entity_id: id,
      action: "delete",
      before: (before ?? null) as unknown as Json,
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
