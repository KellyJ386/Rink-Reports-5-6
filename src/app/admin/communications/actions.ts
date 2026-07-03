"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/observability/log-server-error"
import { dbError } from "@/lib/db-error"
import type { Database, Json } from "@/types/database"

import type { ActionState, SimpleResult } from "./types"
import {
  SLUG_RE,
  UUID_RE,
  asInt,
  nonEmpty,
  parseReminderForm,
  parseRoutingForm,
  slugify,
} from "./_lib/validate"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

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

/**
 * Guard shared by every action in this module. requireAdmin() covers console
 * access (global admin / role fallback), but the communications RLS write
 * policies gate on has_module_admin_access('communications') — a
 * module-scoped user_permissions grant requireAdmin does NOT imply. Without
 * this check, an admin lacking the module grant reaches the action and the
 * mutation dies at the RLS layer with an opaque error. Returns a
 * human-readable denial message, or null when allowed. (A message, not a
 * redirect: these actions run inside try/catch blocks that would swallow the
 * NEXT_REDIRECT control-flow error.)
 */
async function ensureCommsAdmin(): Promise<string | null> {
  await requireAdmin()
  const supabase = await createClient()
  const allowed = await currentUserCan(supabase, "communications", "admin")
  return allowed
    ? null
    : "Your account has admin console access but not the communications module's admin permission. Ask an administrator to grant it under Admin \u2192 Permissions."
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteTemplate(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteGroup(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function removeGroupMember(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// ============================================================================
// Routing rules
// ============================================================================

export async function createRoutingRule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteRoutingRule(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

// ============================================================================
// Reminders
// ============================================================================

export async function createReminder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteReminder(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function reopenAlert(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteAlert(id: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
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
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
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
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// =============================================================================
// Failed-delivery retries (Deliveries tab — I3 from the 360 review)
// =============================================================================

/**
 * Re-queue a terminally-failed email delivery. Resets the attempt counter so
 * the send cron's backoff ladder starts fresh; the row is picked up on the
 * next /api/cron/send-communications run. RLS already restricts the update
 * to communications admins within their own facility.
 */
export async function retryFailedEmail(recipientId: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!UUID_RE.test(recipientId)) {
      return { ok: false, error: "Invalid delivery id." }
    }
    const supabase = await createClient()
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)
    const { data, error } = await supabase
      .from("communication_recipients")
      .update({
        email_status: "pending",
        email_attempts: 0,
        email_next_attempt_at: new Date().toISOString(),
      })
      .eq("id", recipientId)
      .eq("facility_id", facility.facilityId)
      .eq("email_status", "failed")
      .select("id")
      .maybeSingle()
    if (error) {
      return { ok: false, error: dbError(error, "Failed to re-queue delivery.") }
    }
    if (!data) {
      return { ok: false, error: "Delivery not found or no longer failed." }
    }
    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "communication_recipient",
      entity_id: recipientId,
      action: "retry_email",
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

/**
 * Re-queue a failed notification_outbox row for the next drain run. Client
 * UPDATE on the outbox is locked down by RLS (migration 49), so after the
 * admin + facility checks this goes through the service-role client; the
 * row's facility is verified against the caller's before writing.
 */
export async function retryFailedOutboxRow(outboxId: string): Promise<SimpleResult> {
  try {
    const denied = await ensureCommsAdmin()
    if (denied) return { ok: false, error: denied }
    const facility = await resolveFacility()
    if (!facility.ok) return { ok: false, error: facility.error }
    if (!UUID_RE.test(outboxId)) {
      return { ok: false, error: "Invalid notification id." }
    }

    const supabase = await createClient()
    const actor = await resolveActorEmployeeId(supabase, facility.facilityId)

    const admin = createAdminClient()
    const { data: row, error: rowErr } = await admin
      .from("notification_outbox")
      .select("id, facility_id, status")
      .eq("id", outboxId)
      .maybeSingle()
    if (rowErr) {
      return { ok: false, error: dbError(rowErr, "Failed to load notification.") }
    }
    if (!row || row.facility_id !== facility.facilityId) {
      return { ok: false, error: "Notification not found." }
    }
    if (row.status !== "failed") {
      return { ok: false, error: "Notification is no longer failed." }
    }

    const { error: updErr } = await admin
      .from("notification_outbox")
      .update({
        status: "pending",
        scheduled_for: new Date().toISOString(),
        error: null,
      })
      .eq("id", outboxId)
      .eq("status", "failed")
    if (updErr) {
      return { ok: false, error: dbError(updErr, "Failed to re-queue notification.") }
    }

    await writeAudit(supabase, facility.facilityId, actor, {
      entity_type: "notification_outbox",
      entity_id: outboxId,
      action: "retry_outbox",
    })
    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/communications/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
