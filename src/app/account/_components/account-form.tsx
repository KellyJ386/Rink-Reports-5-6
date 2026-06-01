"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"
import { MailWarning } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { PhoneInput } from "@/components/account/phone-input"
import { updateAccountProfile } from "../_lib/actions"
import { INITIAL_ACCOUNT_STATE } from "../_lib/types"
import type { AccountProfile } from "../_lib/types"
import type { AccountFieldName } from "@/lib/account/schema"

interface AccountFormProps {
  profile: AccountProfile
  /** The signed-in user's auth email (source of truth for self email edits). */
  currentEmail: string
  /** Pending (unverified) email change, if any. */
  pendingEmail: string | null
  /** True when the signed-in user is editing their own profile. */
  isSelf: boolean
}

function SubmitButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={!dirty || pending}>
      {pending ? "Saving…" : "Save Changes"}
    </Button>
  )
}

export function AccountForm({
  profile,
  currentEmail,
  pendingEmail,
  isSelf,
}: AccountFormProps) {
  const [state, formAction] = useActionState(
    updateAccountProfile,
    INITIAL_ACCOUNT_STATE,
  )
  const [dirty, setDirty] = React.useState(false)
  const markDirty = React.useCallback(() => setDirty(true), [])

  const errors: Partial<Record<AccountFieldName, string>> =
    state.status === "error" ? (state.fieldErrors ?? {}) : {}

  // Clear the dirty flag when a fresh successful save arrives. Using the
  // adjust-state-during-render pattern avoids calling setState in an effect.
  const [seenState, setSeenState] = React.useState(state)
  if (state !== seenState) {
    setSeenState(state)
    if (state.status === "success") setDirty(false)
  }

  React.useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message)
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  }, [state])

  const errProps = (field: AccountFieldName) =>
    errors[field]
      ? { "aria-invalid": true as const, "aria-describedby": `${field}-error` }
      : {}

  return (
    <form
      action={formAction}
      onChange={markDirty}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="target_user_id" value={profile.id} />

      {/* Contact */}
      <Card className="gap-4 py-5">
        <h2 className="px-6 text-lg font-semibold tracking-tight">Contact</h2>
        <div className="grid gap-4 px-6 sm:grid-cols-2">
          <FormField
            label="Email address"
            htmlFor="email"
            required
            error={errors.email}
            className="sm:col-span-2"
          >
            {isSelf ? (
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={currentEmail}
                {...errProps("email")}
              />
            ) : (
              <Input
                id="email"
                type="email"
                value={profile.email}
                readOnly
                disabled
                aria-describedby="email-readonly-note"
              />
            )}
          </FormField>
          {!isSelf && (
            <p
              id="email-readonly-note"
              className="px-0 text-xs text-muted-foreground sm:col-span-2"
            >
              Email can only be changed by the account owner (it requires
              re-verification).
            </p>
          )}
          {isSelf && pendingEmail && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 sm:col-span-2"
            >
              <MailWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                A change to <strong>{pendingEmail}</strong> is pending. Check
                that inbox and click the confirmation link — your current email
                stays active until then.
              </span>
            </div>
          )}

          <FormField label="Phone number" htmlFor="phone" required error={errors.phone}>
            <PhoneInput
              id="phone"
              name="phone"
              defaultValue={profile.phone}
              invalid={Boolean(errors.phone)}
              describedBy={errors.phone ? "phone-error" : undefined}
              required
              onDirty={markDirty}
            />
          </FormField>
        </div>
      </Card>

      {/* Mailing address */}
      <Card className="gap-4 py-5">
        <h2 className="px-6 text-lg font-semibold tracking-tight">
          Mailing address
        </h2>
        <div className="grid gap-4 px-6 sm:grid-cols-2">
          <FormField
            label="Street address"
            htmlFor="address_line1"
            required
            error={errors.address_line1}
            className="sm:col-span-2"
          >
            <Input
              id="address_line1"
              name="address_line1"
              autoComplete="address-line1"
              defaultValue={profile.address_line1 ?? ""}
              {...errProps("address_line1")}
            />
          </FormField>
          <FormField
            label="Apartment, suite, etc. (optional)"
            htmlFor="address_line2"
            error={errors.address_line2}
            className="sm:col-span-2"
          >
            <Input
              id="address_line2"
              name="address_line2"
              autoComplete="address-line2"
              defaultValue={profile.address_line2 ?? ""}
              {...errProps("address_line2")}
            />
          </FormField>
          <FormField label="City" htmlFor="city" required error={errors.city}>
            <Input
              id="city"
              name="city"
              autoComplete="address-level2"
              defaultValue={profile.city ?? ""}
              {...errProps("city")}
            />
          </FormField>
          <FormField
            label="State / province"
            htmlFor="state_province"
            required
            error={errors.state_province}
          >
            <Input
              id="state_province"
              name="state_province"
              autoComplete="address-level1"
              defaultValue={profile.state_province ?? ""}
              {...errProps("state_province")}
            />
          </FormField>
          <FormField
            label="Postal code"
            htmlFor="postal_code"
            required
            error={errors.postal_code}
          >
            <Input
              id="postal_code"
              name="postal_code"
              autoComplete="postal-code"
              defaultValue={profile.postal_code ?? ""}
              {...errProps("postal_code")}
            />
          </FormField>
          <FormField
            label="Country"
            htmlFor="country"
            required
            error={errors.country}
          >
            <Input
              id="country"
              name="country"
              autoComplete="country-name"
              defaultValue={profile.country ?? ""}
              {...errProps("country")}
            />
          </FormField>
        </div>
      </Card>

      {/* Emergency contact */}
      <Card className="gap-4 py-5">
        <h2 className="px-6 text-lg font-semibold tracking-tight">
          Emergency contact
        </h2>
        <div className="grid gap-4 px-6 sm:grid-cols-2">
          <FormField
            label="Contact name"
            htmlFor="emergency_contact_name"
            required
            error={errors.emergency_contact_name}
          >
            <Input
              id="emergency_contact_name"
              name="emergency_contact_name"
              autoComplete="name"
              defaultValue={profile.emergency_contact_name ?? ""}
              {...errProps("emergency_contact_name")}
            />
          </FormField>
          <FormField
            label="Contact phone"
            htmlFor="emergency_contact_phone"
            required
            error={errors.emergency_contact_phone}
          >
            <PhoneInput
              id="emergency_contact_phone"
              name="emergency_contact_phone"
              defaultValue={profile.emergency_contact_phone}
              invalid={Boolean(errors.emergency_contact_phone)}
              describedBy={
                errors.emergency_contact_phone
                  ? "emergency_contact_phone-error"
                  : undefined
              }
              required
              onDirty={markDirty}
            />
          </FormField>
        </div>
      </Card>

      {/* Notifications */}
      <Card className="gap-4 py-5">
        <h2 className="px-6 text-lg font-semibold tracking-tight">
          Notifications
        </h2>
        <div className="flex items-start justify-between gap-4 px-6">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="sms_opt_in"
              className="text-sm font-medium leading-none"
            >
              Receive text message notifications
            </label>
            <p className="text-sm text-muted-foreground">
              Master switch for SMS alerts. When off, no text messages of any
              kind are sent to you.
            </p>
          </div>
          <SmsToggle
            defaultChecked={profile.sms_opt_in}
            onToggle={markDirty}
          />
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <SubmitButton dirty={dirty} />
      </div>
    </form>
  )
}

function SmsToggle({
  defaultChecked,
  onToggle,
}: {
  defaultChecked: boolean
  onToggle: () => void
}) {
  const [checked, setChecked] = React.useState(defaultChecked)
  return (
    <>
      <Switch
        id="sms_opt_in"
        checked={checked}
        onCheckedChange={(value) => {
          setChecked(value)
          onToggle()
        }}
        aria-label="Receive text message notifications"
      />
      <input type="hidden" name="sms_opt_in" value={checked ? "true" : "false"} />
    </>
  )
}
