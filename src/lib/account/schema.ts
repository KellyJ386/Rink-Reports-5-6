import { z } from "zod"

import { normalizePhone } from "./phone"

/**
 * Authoritative validation for the account form. Used by the server action
 * (the source of truth — validation runs on submit) and re-usable on the
 * client. Every field is required except `address_line2`.
 */

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} is too long.`)

const phoneField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .transform((value, ctx) => {
      const result = normalizePhone(value)
      if (!result.ok) {
        ctx.addIssue({
          code: "custom",
          message: `Enter a valid ${label.toLowerCase()} in international format.`,
        })
        return z.NEVER
      }
      return result.e164
    })

export const accountProfileSchema = z.object({
  address_line1: requiredText("Street address", 200),
  address_line2: z.string().trim().max(200, "Address line 2 is too long.").optional().default(""),
  city: requiredText("City", 120),
  state_province: requiredText("State / province", 120),
  postal_code: requiredText("Postal code", 40),
  country: requiredText("Country", 120),
  phone: phoneField("Phone number"),
  emergency_contact_name: requiredText("Emergency contact name", 200),
  emergency_contact_phone: phoneField("Emergency contact phone"),
  sms_opt_in: z.coerce.boolean(),
})

export type AccountProfileInput = z.input<typeof accountProfileSchema>
export type AccountProfileValues = z.output<typeof accountProfileSchema>

/** Optional, self-only email change (verified separately via Supabase Auth). */
export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .max(320, "Email is too long.")

export type AccountFieldName =
  | keyof AccountProfileValues
  | "email"

/**
 * Parse a FormData payload into validated values + per-field errors.
 * Returns flattened field errors keyed by field name for inline display.
 */
export function parseAccountForm(formData: FormData): {
  values: AccountProfileValues | null
  fieldErrors: Partial<Record<AccountFieldName, string>>
} {
  const raw = {
    address_line1: String(formData.get("address_line1") ?? ""),
    address_line2: String(formData.get("address_line2") ?? ""),
    city: String(formData.get("city") ?? ""),
    state_province: String(formData.get("state_province") ?? ""),
    postal_code: String(formData.get("postal_code") ?? ""),
    country: String(formData.get("country") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    emergency_contact_name: String(formData.get("emergency_contact_name") ?? ""),
    emergency_contact_phone: String(formData.get("emergency_contact_phone") ?? ""),
    sms_opt_in: formData.get("sms_opt_in") === "true",
  }

  const result = accountProfileSchema.safeParse(raw)
  if (result.success) {
    return { values: result.data, fieldErrors: {} }
  }

  const fieldErrors: Partial<Record<AccountFieldName, string>> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0] as AccountFieldName | undefined
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return { values: null, fieldErrors }
}
