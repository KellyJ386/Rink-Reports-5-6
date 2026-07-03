// Server-only compose-message pipeline shared by the online server action
// (`actions.ts`) AND the offline replay consumer (`offline.ts`, dispatched
// from /api/offline-sync for moduleKey "communications"). Pure parsing/
// validation lives in `compose.ts` (unit-tested); this module adds the
// Supabase I/O so both paths land the same rows with the same checks.

import type { createClient } from "@/lib/supabase/server"

import {
  buildRecipientRows,
  filterSendableGroups,
  type MessageInput,
} from "./compose"

// Re-export the parsers/validators callers import from here.
export {
  buildMessageInputFromForm,
  buildMessageInputFromObject,
  buildMessageInputFromObject as buildMessageInputFromPayload,
  validateMessageInput,
  isUuid,
} from "./compose"
export type { MessageInput, ComposeFieldName } from "./compose"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null
function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type PersistMessageResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string }

/**
 * Resolve recipients (group fan-out and/or direct employee ids), insert the
 * message + recipient rows, and write a best-effort audit row. `isAdmin`
 * gates the staff-only `staff_can_message` group restriction (mig 59) AND
 * direct-recipient use: non-admins may only address employees directly when
 * REPLYING to a message they received, and only to that message's sender —
 * otherwise any submit-holder could DM anyone. Admin callers (broadcast) may
 * pass arbitrary same-facility recipients and a null `employeeId` (system /
 * admin-without-employee-row sends).
 */
export async function persistMessage(
  supabase: SupabaseClient,
  args: {
    employeeId: string | null
    facilityId: string
    isAdmin: boolean
    input: MessageInput
  },
): Promise<PersistMessageResult> {
  const { employeeId, facilityId, isAdmin, input } = args

  let recipientIds: string[] = []

  if (input.groupIds.length > 0) {
    // Confirm groups belong to this facility, then apply the pure
    // send-eligibility rule: active groups only, and non-admin staff are
    // further restricted to groups with staff_can_message=true (mig 59).
    const { data: groupRows, error: groupErr } = await supabase
      .from("communication_groups")
      .select("id, facility_id, is_active, staff_can_message")
      .in("id", input.groupIds)
      .eq("facility_id", facilityId)

    if (groupErr) {
      return { ok: false, error: dbError(groupErr, "Failed to load recipient groups.") }
    }
    const sendableGroups = filterSendableGroups(groupRows ?? [], { isAdmin })
    if (sendableGroups.length === 0) {
      return { ok: false, error: "Selected groups are not available." }
    }

    const validGroupIds = sendableGroups.map((g) => g.id)

    // Resolve recipients by union of group memberships.
    const { data: memberRows, error: memberErr } = await supabase
      .from("communication_group_members")
      .select("employee_id")
      .in("group_id", validGroupIds)
      .eq("facility_id", facilityId)

    if (memberErr) {
      return { ok: false, error: dbError(memberErr, "Failed to resolve recipients.") }
    }
    recipientIds = (memberRows ?? []).map((r) => r.employee_id)
  }

  // Validate the parent message (when replying) BEFORE honoring direct
  // recipients: it must be a same-facility message, and for non-admins the
  // caller must actually be one of its recipients.
  let parentSenderId: string | null = null
  if (input.parentMessageId) {
    const { data: parent } = await supabase
      .from("communication_messages")
      .select("id, sender_employee_id")
      .eq("id", input.parentMessageId)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!parent) {
      return { ok: false, error: "The message you're replying to isn't available." }
    }
    parentSenderId = parent.sender_employee_id
    if (!isAdmin) {
      if (!employeeId) {
        return { ok: false, error: "Your account isn't linked to an employee." }
      }
      const { data: myReceipt } = await supabase
        .from("communication_recipients")
        .select("id")
        .eq("message_id", input.parentMessageId)
        .eq("employee_id", employeeId)
        .maybeSingle()
      if (!myReceipt) {
        return { ok: false, error: "You can only reply to messages you received." }
      }
    }
  }

  if (input.recipientEmployeeIds.length > 0) {
    if (!isAdmin) {
      // Staff direct sends exist ONLY as reply-to-sender.
      if (!input.parentMessageId) {
        return {
          ok: false,
          error: "Pick a recipient group, or reply to a message.",
        }
      }
      const onlySender =
        parentSenderId !== null &&
        input.recipientEmployeeIds.every((id) => id === parentSenderId)
      if (!onlySender) {
        return { ok: false, error: "Replies can only go to the original sender." }
      }
    }

    // Direct recipients must be active employees of this facility.
    const { data: employeeRows, error: employeeErr } = await supabase
      .from("employees")
      .select("id")
      .in("id", input.recipientEmployeeIds)
      .eq("facility_id", facilityId)
      .eq("is_active", true)
    if (employeeErr) {
      return { ok: false, error: dbError(employeeErr, "Failed to resolve recipients.") }
    }
    const validIds = new Set((employeeRows ?? []).map((e) => e.id))
    if (validIds.size !== input.recipientEmployeeIds.length) {
      return { ok: false, error: "Some recipients are not available." }
    }
    recipientIds = recipientIds.concat(input.recipientEmployeeIds)
  }

  recipientIds = Array.from(new Set(recipientIds))
  if (recipientIds.length === 0) {
    return { ok: false, error: "The selected groups don't have any members." }
  }

  // Insert the message.
  const { data: inserted, error: insertErr } = await supabase
    .from("communication_messages")
    .insert({
      facility_id: facilityId,
      sender_employee_id: employeeId,
      parent_message_id: input.parentMessageId,
      subject: input.subject,
      body: input.body,
      requires_acknowledgement: input.requiresAck,
      template_id: input.templateId,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (insertErr || !inserted) {
    return { ok: false, error: dbError(insertErr, "Failed to send message.") }
  }

  // Batch-insert recipients (deduped + shaped by the pure helper).
  const recipientRows = buildRecipientRows(
    inserted.id,
    facilityId,
    recipientIds,
    new Date().toISOString(),
  )

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
    facility_id: facilityId,
    actor_employee_id: employeeId,
    action: "message_sent",
    entity_type: "communication_message",
    entity_id: inserted.id,
  })

  return { ok: true, messageId: inserted.id }
}
