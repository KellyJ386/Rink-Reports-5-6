import type { AccountFieldName } from "@/lib/account/schema"

/** Profile columns surfaced on the account page. */
export type AccountProfile = {
  id: string
  facility_id: string | null
  email: string
  full_name: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_province: string | null
  postal_code: string | null
  country: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  sms_opt_in: boolean
}

export type AccountActionState =
  | { status: "idle" }
  | {
      status: "error"
      message?: string
      fieldErrors?: Partial<Record<AccountFieldName, string>>
    }
  | {
      status: "success"
      message: string
      /** True when an email change was requested and is awaiting verification. */
      emailChangePending?: boolean
    }

export const INITIAL_ACCOUNT_STATE: AccountActionState = { status: "idle" }
