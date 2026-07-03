// Pure compose-message helpers: payload/form parsing + validation. NO
// server-only imports live here, so this module is safe to unit-test in
// isolation (see compose.test.ts) and is re-used by the server-only
// `submit.ts` (which adds the Supabase I/O).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Normalized compose-message input. Mirrors what the online `sendMessage`
 * action collects from its `FormData`. `subject` and `templateId` are nullable;
 * `body` and `groupIds` are validated to be non-empty by the caller.
 */
export type MessageInput = {
  subject: string | null
  body: string
  requiresAck: boolean
  templateId: string | null
  groupIds: string[]
}

/** Build a normalized input from a parsed JSON object (e.g. offline replay). */
export function buildMessageInputFromObject(obj: unknown): MessageInput | null {
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>

  const subject = str(o.subject)
  const body = str(o.body)

  const requiresAck =
    o.requires_acknowledgement === true ||
    o.requires_acknowledgement === "on" ||
    o.requires_acknowledgement === "true"

  const templateIdRaw = str(o.template_id)
  const templateId =
    templateIdRaw.length > 0 && isUuid(templateIdRaw) ? templateIdRaw : null

  const rawGroupIds = Array.isArray(o.group_ids) ? o.group_ids : []
  const groupIds = Array.from(
    new Set(
      rawGroupIds
        .map((v) => str(v))
        .filter((v) => v.length > 0 && isUuid(v)),
    ),
  )

  return {
    subject: subject.length > 0 ? subject : null,
    body,
    requiresAck,
    templateId,
    groupIds,
  }
}

/** Online path: parse the compose form's fields into a normalized input. */
export function buildMessageInputFromForm(
  formData: FormData,
): MessageInput | null {
  return buildMessageInputFromObject({
    subject: formData.get("subject"),
    body: formData.get("body"),
    requires_acknowledgement: formData.get("requires_acknowledgement"),
    template_id: formData.get("template_id"),
    group_ids: formData.getAll("group_ids").map((v) => String(v)),
  })
}

/**
 * Which of the sender's selected groups may actually receive the message:
 * active groups only, and non-admin staff are further restricted to groups
 * flagged staff_can_message (mig 59). Pure seam extracted from persistMessage
 * (submit.ts) so the send-eligibility rule is unit-testable.
 */
export function filterSendableGroups<
  T extends { is_active: boolean; staff_can_message: boolean },
>(groups: T[], opts: { isAdmin: boolean }): T[] {
  return groups.filter(
    (g) => g.is_active && (opts.isAdmin || g.staff_can_message),
  )
}

export type RecipientRow = {
  message_id: string
  employee_id: string
  facility_id: string
  delivered_at: string
}

/**
 * Shape the batch of communication_recipients rows for a send: dedupes
 * employee ids (an employee in several selected groups gets ONE row — the
 * unique (message_id, employee_id) index would reject duplicates) and stamps
 * every row with the same delivery timestamp.
 */
export function buildRecipientRows(
  messageId: string,
  facilityId: string,
  memberEmployeeIds: string[],
  nowIso: string,
): RecipientRow[] {
  return Array.from(new Set(memberEmployeeIds)).map((employeeId) => ({
    message_id: messageId,
    employee_id: employeeId,
    facility_id: facilityId,
    delivered_at: nowIso,
  }))
}

export type ComposeFieldName = "body" | "group_ids"

export type MessageValidation =
  | { ok: true }
  | { ok: false; fieldErrors: Partial<Record<ComposeFieldName, string>> }

/**
 * Field-level validation for a compose-message input. Errors are returned in
 * visual order so the form can auto-focus the topmost invalid field.
 */
export function validateMessageInput(input: MessageInput): MessageValidation {
  const fieldErrors: Partial<Record<ComposeFieldName, string>> = {}
  if (!input.body) fieldErrors.body = "Please enter a message."
  if (input.groupIds.length === 0) {
    fieldErrors.group_ids = "Pick at least one recipient group."
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }
  return { ok: true }
}
