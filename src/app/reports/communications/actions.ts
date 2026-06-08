"use server"

import { redirect } from "next/navigation"

import { getIsAdmin, requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import {
  buildMessageInputFromForm,
  persistMessage,
  validateMessageInput,
} from "./_lib/submit"

export type ComposeFieldName = "body" | "group_ids"

export type SendMessageFormState = {
  error?: string
  fieldErrors?: Partial<Record<ComposeFieldName, string>>
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
  | { ok: false; error?: string; fieldErrors?: Partial<Record<ComposeFieldName, string>> }

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
  if (!(await currentUserCan(supabase, "communications", "submit"))) {
    return {
      ok: false,
      error: "You don't have permission to send messages.",
    }
  }

  const input = buildMessageInputFromForm(formData)
  if (!input) {
    return { ok: false, error: "Couldn't read the message. Please try again." }
  }

  // Collect field-level errors in visual order so auto-focus picks the
  // topmost invalid field. Top-level errors (DB, permission) returned
  // separately via `error`.
  const validation = validateMessageInput(input)
  if (!validation.ok) {
    return { ok: false, fieldErrors: validation.fieldErrors }
  }

  const isAdmin = await getIsAdmin(current)
  const result = await persistMessage(supabase, {
    employeeId: employeeRow.id,
    facilityId: employeeRow.facility_id,
    isAdmin,
    input,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    redirectTo: `/reports/communications/compose/done?id=${result.messageId}`,
  }
}

export async function sendCommunicationsMessage(
  _prev: SendMessageFormState,
  formData: FormData
): Promise<SendMessageFormState> {
  const result = await performSendMessage(formData)
  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors }
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
