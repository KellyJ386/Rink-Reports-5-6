"use server"

import { redirect } from "next/navigation"

import { getIsAdmin, requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export type SendMessageFormState = {
  error?: string
}

export type AckAlertFormState = {
  error?: string
  ok?: boolean
}

export type MessageActionFormState = {
  error?: string
  ok?: boolean
}

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

async function resolveCurrentEmployee() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow, error } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  return { supabase, current, employeeRow, error }
}

type SendResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string }

async function performSendMessage(formData: FormData): Promise<SendResult> {
  const { supabase, current, employeeRow, error: empErr } =
    await resolveCurrentEmployee()

  if (empErr) {
    return {
      ok: false,
      error: dbError(empErr, "Failed to load your account."),
    }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error:
        "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  // Defense-in-depth: confirm the user has submit on the communications module.
  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "communications")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return {
      ok: false,
      error: "You don't have permission to send messages.",
    }
  }

  const subject = String(formData.get("subject") ?? "").trim()
  const body = String(formData.get("body") ?? "").trim()
  const requiresAck = formData.get("requires_acknowledgement") === "on"
  const templateIdRaw = String(formData.get("template_id") ?? "").trim()
  const templateId =
    templateIdRaw.length > 0 && isUuid(templateIdRaw) ? templateIdRaw : null

  if (!body) {
    return { ok: false, error: "Please enter a message." }
  }

  const groupIds = formData
    .getAll("group_ids")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0 && isUuid(v))

  const uniqueGroupIds = Array.from(new Set(groupIds))

  if (uniqueGroupIds.length === 0) {
    return { ok: false, error: "Pick at least one recipient group." }
  }

  // Confirm groups belong to this facility and are active. Non-admin staff
  // are further restricted to groups with staff_can_message=true (mig 59).
  const isAdmin = await getIsAdmin(current)
  let groupSelect = supabase
    .from("communication_groups")
    .select("id, facility_id, is_active, staff_can_message")
    .in("id", uniqueGroupIds)
    .eq("facility_id", employeeRow.facility_id)
    .eq("is_active", true)
  if (!isAdmin) {
    groupSelect = groupSelect.eq("staff_can_message", true)
  }
  const { data: groupRows, error: groupErr } = await groupSelect

  if (groupErr) {
    return {
      ok: false,
      error: dbError(groupErr, "Failed to load recipient groups."),
    }
  }
  if (!groupRows || groupRows.length === 0) {
    return { ok: false, error: "Selected groups are not available." }
  }

  const validGroupIds = groupRows.map((g) => g.id)

  // Resolve recipients by union of group memberships.
  const { data: memberRows, error: memberErr } = await supabase
    .from("communication_group_members")
    .select("employee_id")
    .in("group_id", validGroupIds)
    .eq("facility_id", employeeRow.facility_id)

  if (memberErr) {
    return {
      ok: false,
      error: dbError(memberErr, "Failed to resolve recipients."),
    }
  }

  const recipientIds = Array.from(
    new Set((memberRows ?? []).map((r) => r.employee_id))
  )

  if (recipientIds.length === 0) {
    return {
      ok: false,
      error: "The selected groups don't have any members.",
    }
  }

  // Insert the message.
  const { data: inserted, error: insertErr } = await supabase
    .from("communication_messages")
    .insert({
      facility_id: employeeRow.facility_id,
      sender_employee_id: employeeRow.id,
      subject: subject.length > 0 ? subject : null,
      body,
      requires_acknowledgement: requiresAck,
      template_id: templateId,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: dbError(insertErr, "Failed to send message."),
    }
  }

  // Batch-insert recipients.
  const nowIso = new Date().toISOString()
  const recipientRows = recipientIds.map((employeeId) => ({
    message_id: inserted.id,
    employee_id: employeeId,
    facility_id: employeeRow.facility_id,
    delivered_at: nowIso,
  }))

  const { error: recipErr } = await supabase
    .from("communication_recipients")
    .insert(recipientRows)

  if (recipErr) {
    // Best-effort cleanup. Cascades will clear any rows already inserted.
    await supabase
      .from("communication_messages")
      .delete()
      .eq("id", inserted.id)
    return {
      ok: false,
      error: dbError(recipErr, "Failed to deliver message to recipients."),
    }
  }

  // Best-effort audit row. Don't fail the send if this errors.
  await supabase.from("communication_audit_log").insert({
    facility_id: employeeRow.facility_id,
    actor_employee_id: employeeRow.id,
    action: "message_sent",
    entity_type: "communication_message",
    entity_id: inserted.id,
  })

  return {
    ok: true,
    redirectTo: `/reports/communications/compose/done?id=${inserted.id}`,
  }
}

export async function sendCommunicationsMessage(
  _prev: SendMessageFormState,
  formData: FormData
): Promise<SendMessageFormState> {
  const result = await performSendMessage(formData)
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectTo)
}

/**
 * Acknowledge an alert. Idempotent: if the user has already acked, returns ok.
 */
export async function acknowledgeAlert(
  _prev: AckAlertFormState,
  formData: FormData
): Promise<AckAlertFormState> {
  const alertId = String(formData.get("alert_id") ?? "").trim()
  const notesRaw = String(formData.get("notes") ?? "").trim()
  const notes = notesRaw.length > 0 ? notesRaw : null

  if (!alertId || !isUuid(alertId)) {
    return { error: "Invalid alert." }
  }

  const { supabase, employeeRow, error: empErr } =
    await resolveCurrentEmployee()

  if (empErr) {
    return { error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return { error: "Your account isn't fully set up." }
  }

  // Confirm alert belongs to this facility (defense in depth — RLS should also
  // enforce).
  const { data: alertRow } = await supabase
    .from("communication_alerts")
    .select("id, facility_id")
    .eq("id", alertId)
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()

  if (!alertRow) {
    return { error: "Alert not found." }
  }

  const { error: insertErr } = await supabase
    .from("communication_acknowledgements")
    .insert({
      alert_id: alertId,
      employee_id: employeeRow.id,
      facility_id: employeeRow.facility_id,
      acknowledged_at: new Date().toISOString(),
      notes,
    })

  // 23505 = unique violation -> already acked. Treat as success.
  if (insertErr && insertErr.code !== "23505") {
    return {
      error: dbError(insertErr, "Failed to acknowledge alert."),
    }
  }

  return { ok: true }
}

/**
 * Mark a message as read for the current employee.
 */
export async function markMessageRead(
  _prev: MessageActionFormState,
  formData: FormData
): Promise<MessageActionFormState> {
  const messageId = String(formData.get("message_id") ?? "").trim()

  if (!messageId || !isUuid(messageId)) {
    return { error: "Invalid message." }
  }

  const { supabase, employeeRow, error: empErr } =
    await resolveCurrentEmployee()

  if (empErr) {
    return { error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return { error: "Your account isn't fully set up." }
  }

  const { error: updateErr } = await supabase
    .from("communication_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .eq("employee_id", employeeRow.id)
    .is("read_at", null)

  if (updateErr) {
    return {
      error: dbError(updateErr, "Failed to mark message as read."),
    }
  }

  return { ok: true }
}

/**
 * Acknowledge a message. Updates the recipient row AND inserts a row into
 * `communication_acknowledgements` for cross-table audit consistency.
 */
export async function acknowledgeMessage(
  _prev: MessageActionFormState,
  formData: FormData
): Promise<MessageActionFormState> {
  const messageId = String(formData.get("message_id") ?? "").trim()
  const notesRaw = String(formData.get("notes") ?? "").trim()
  const notes = notesRaw.length > 0 ? notesRaw : null

  if (!messageId || !isUuid(messageId)) {
    return { error: "Invalid message." }
  }

  const { supabase, employeeRow, error: empErr } =
    await resolveCurrentEmployee()

  if (empErr) {
    return { error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return { error: "Your account isn't fully set up." }
  }

  const nowIso = new Date().toISOString()

  const { error: updateErr } = await supabase
    .from("communication_recipients")
    .update({ acknowledged_at: nowIso, read_at: nowIso })
    .eq("message_id", messageId)
    .eq("employee_id", employeeRow.id)

  if (updateErr) {
    return {
      error: dbError(updateErr, "Failed to acknowledge message."),
    }
  }

  const { error: ackErr } = await supabase
    .from("communication_acknowledgements")
    .insert({
      message_id: messageId,
      employee_id: employeeRow.id,
      facility_id: employeeRow.facility_id,
      acknowledged_at: nowIso,
      notes,
    })

  // 23505 = unique violation -> already in audit log. Treat as success.
  if (ackErr && ackErr.code !== "23505") {
    return { error: dbError(ackErr, "Failed to record acknowledgement.") }
  }

  return { ok: true }
}
