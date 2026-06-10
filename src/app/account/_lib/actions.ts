"use server"

import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { parseAccountForm, emailSchema } from "@/lib/account/schema"
import { canEditProfile, loadAccountProfile, profileDisplayName } from "./queries"
import { notifyProfileEdited } from "./notify"
import type { AccountActionState } from "./types"
import type { Json } from "@/types/database"

const FIELD_LABELS: Record<string, string> = {
  address_line1: "Street address",
  address_line2: "Address line 2",
  city: "City",
  state_province: "State / province",
  postal_code: "Postal code",
  country: "Country",
  phone: "Phone number",
  emergency_contact_name: "Emergency contact name",
  emergency_contact_phone: "Emergency contact phone",
  sms_opt_in: "Text message notifications",
}

export async function updateAccountProfile(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const current = await requireUser()
  const editorId = current.authUser.id

  const targetUserId =
    String(formData.get("target_user_id") ?? "").trim() || editorId
  const isSelf = targetUserId === editorId

  // Permission gate (defense in depth — RLS also enforces this).
  if (!isSelf) {
    const allowed = await canEditProfile(targetUserId)
    if (!allowed) {
      return {
        status: "error",
        message: "You don't have permission to edit this profile.",
      }
    }
  }

  // Validate (on submit). Email is only editable for self-edits.
  const { values, fieldErrors } = parseAccountForm(formData)
  let emailChange: string | null = null
  if (isSelf) {
    const rawEmail = String(formData.get("email") ?? "")
    const emailResult = emailSchema.safeParse(rawEmail)
    if (!emailResult.success) {
      fieldErrors.email =
        emailResult.error.issues[0]?.message ?? "Enter a valid email address."
    } else if (
      emailResult.data.toLowerCase() !==
      (current.authUser.email ?? "").toLowerCase()
    ) {
      emailChange = emailResult.data
    }
  }

  if (!values || Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors,
    }
  }

  const existing = await loadAccountProfile(targetUserId)
  if (!existing) {
    return { status: "error", message: "Profile not found." }
  }

  const updatePayload = {
    address_line1: values.address_line1,
    address_line2: values.address_line2 ? values.address_line2 : null,
    city: values.city,
    state_province: values.state_province,
    postal_code: values.postal_code,
    country: values.country,
    phone: values.phone,
    emergency_contact_name: values.emergency_contact_name,
    emergency_contact_phone: values.emergency_contact_phone,
    sms_opt_in: values.sms_opt_in,
    updated_at: new Date().toISOString(),
  }

  // Diff against the saved row so the audit log + notifications only list
  // fields that actually changed.
  const changes: Record<string, { from: Json; to: Json }> = {}
  const changedLabels: string[] = []
  for (const key of Object.keys(FIELD_LABELS)) {
    // Profile fields are text/boolean columns, so the values are Json-safe.
    const before = ((existing as Record<string, unknown>)[key] ?? null) as Json
    const after = ((updatePayload as Record<string, unknown>)[key] ?? null) as Json
    const normalizedBefore = typeof before === "boolean" ? before : (before ?? "")
    const normalizedAfter = typeof after === "boolean" ? after : (after ?? "")
    if (normalizedBefore !== normalizedAfter) {
      changes[key] = { from: before, to: after }
      changedLabels.push(FIELD_LABELS[key]!)
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("users")
    .update(updatePayload)
    .eq("id", targetUserId)

  if (error) {
    return { status: "error", message: error.message }
  }

  // Self-service email change: not applied immediately. Supabase sends a
  // confirmation link to the NEW address; the old email stays active until
  // it's verified (and the pending change expires if unconfirmed).
  let emailChangePending = false
  if (isSelf && emailChange) {
    const { error: emailErr } = await supabase.auth.updateUser({
      email: emailChange,
    })
    if (emailErr) {
      return {
        status: "error",
        message: `Profile saved, but the email change could not be started: ${emailErr.message}`,
      }
    }
    emailChangePending = true
  }

  // Supervisor+ edited someone else: write the audit log + notify.
  if (!isSelf && changedLabels.length > 0) {
    await supabase.from("profile_audit_log").insert({
      facility_id: existing.facility_id,
      edited_by: editorId,
      target_user_id: targetUserId,
      changed_fields: changes,
    })

    await notifyProfileEdited({
      facilityId: existing.facility_id,
      editorName:
        current.profile?.full_name?.trim() ||
        current.authUser.email ||
        "An administrator",
      editorUserId: editorId,
      target: {
        id: existing.id,
        email: existing.email,
        name: profileDisplayName(existing),
      },
      changedFieldLabels: changedLabels,
    })
  }

  revalidatePath("/account")
  revalidatePath(`/account/${targetUserId}`)

  return {
    status: "success",
    message: emailChangePending
      ? "Profile saved. Check your new inbox to confirm your email change."
      : "Profile saved.",
    emailChangePending,
  }
}
