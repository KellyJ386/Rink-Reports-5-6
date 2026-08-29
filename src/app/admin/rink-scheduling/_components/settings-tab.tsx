"use client"

import { useActionState, useEffect } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { updateModuleSettings } from "../actions"
import { SLOT_INCREMENT_CHOICES, formatTaxRateAsPercent } from "../_lib/config"
import type { ActionState, SettingsRow } from "../types"

const INITIAL: ActionState = { ok: null }

export function SettingsTab({ settings }: { settings: SettingsRow | null }) {
  const [state, action, pending] = useActionState(updateModuleSettings, INITIAL)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Settings saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  // Defaults mirror the column defaults in migration 247, so the first save of
  // a facility that has never had a settings row cannot silently change a
  // value the admin never touched.
  const s = {
    default_buffer_minutes: settings?.default_buffer_minutes ?? 15,
    buffer_included_in_rental: settings?.buffer_included_in_rental ?? false,
    default_resurface_minutes: settings?.default_resurface_minutes ?? 15,
    slot_increment_minutes: settings?.slot_increment_minutes ?? 30,
    default_payment_terms_days: settings?.default_payment_terms_days ?? 30,
    invoice_prefix: settings?.invoice_prefix ?? "INV-",
    tax_rate: settings?.tax_rate ?? null,
    coverage_check_enabled: settings?.coverage_check_enabled ?? true,
    locker_lead_minutes: settings?.locker_lead_minutes ?? 45,
    locker_vacate_minutes: settings?.locker_vacate_minutes ?? 30,
    display_refresh_seconds: settings?.display_refresh_seconds ?? 60,
    send_booking_confirmations: settings?.send_booking_confirmations ?? false,
    overdue_reminders_enabled: settings?.overdue_reminders_enabled ?? true,
    reminder_cadence_days: settings?.reminder_cadence_days ?? 7,
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Module settings</CardTitle>
        <CardDescription>
          One row per facility. These drive the calendar, invoicing and the
          lobby displays. Changing a default never alters bookings or invoices
          that already exist.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Calendar</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="buffer">Ice-make time (minutes)</Label>
                <Input
                  id="buffer"
                  name="default_buffer_minutes"
                  type="number"
                  min={0}
                  max={120}
                  defaultValue={s.default_buffer_minutes}
                />
                <p className="text-muted-foreground text-xs">
                  Most rinks use 10 or 15 minutes. A rink can override this on
                  the Facility setup tab.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="resurface">Resurface duration (minutes)</Label>
                <Input
                  id="resurface"
                  name="default_resurface_minutes"
                  type="number"
                  min={1}
                  max={120}
                  defaultValue={s.default_resurface_minutes}
                />
                <p className="text-muted-foreground text-xs">
                  How long an ice cut booked on the calendar lasts. A rink can
                  override this on the Facility setup tab.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="slot">Calendar slot (minutes)</Label>
                <select
                  id="slot"
                  name="slot_increment_minutes"
                  defaultValue={String(s.slot_increment_minutes)}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  {SLOT_INCREMENT_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground text-xs">
                  The grid&rsquo;s snap size when dragging out a booking.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="buffer_included_in_rental"
                  defaultChecked={s.buffer_included_in_rental}
                  className="border-input size-4 rounded border"
                />
                Ice-make time is included in the rental hour
              </label>
              <p className="text-muted-foreground text-xs">
                On: a booking is billed for its full length and nothing is
                reserved after it — the flood happens inside the hour the
                customer already paid for (e.g. a 60-minute rental is ~50
                minutes of ice plus a 10-minute make at the end). Off (most
                rinks): the ice-make minutes above are reserved AFTER each
                booking, so the next slot can&rsquo;t start until the flood is
                done. Either way, invoicing always bills the booked hours —
                this only changes whether time is blocked after the booking.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="coverage_check_enabled"
                defaultChecked={s.coverage_check_enabled}
                className="border-input size-4 rounded border"
              />
              Flag bookings with no staff scheduled, or outside operating hours
            </label>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Billing</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="terms">Payment terms (days)</Label>
                <Input
                  id="terms"
                  name="default_payment_terms_days"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={s.default_payment_terms_days}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="prefix">Invoice prefix</Label>
                <Input
                  id="prefix"
                  name="invoice_prefix"
                  defaultValue={s.invoice_prefix}
                  maxLength={12}
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tax">Tax rate (%)</Label>
                <Input
                  id="tax"
                  name="tax_rate_percent"
                  inputMode="decimal"
                  placeholder="none"
                  defaultValue={formatTaxRateAsPercent(s.tax_rate)}
                />
                <p className="text-muted-foreground text-xs">
                  Leave blank for no tax line at all. That is different from
                  entering 0.
                </p>
              </div>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Billing emails</legend>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="send_booking_confirmations"
                  defaultChecked={s.send_booking_confirmations}
                  className="border-input size-4 rounded border"
                />
                Send booking confirmation emails
              </label>
              <p className="text-muted-foreground text-xs">
                Email the customer&rsquo;s billing contact when a booking is
                created.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="overdue_reminders_enabled"
                  defaultChecked={s.overdue_reminders_enabled}
                  className="border-input size-4 rounded border"
                />
                Send overdue invoice reminders
              </label>
              <p className="text-muted-foreground text-xs">
                A daily job emails customers about invoices past their due date.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="cadence">Reminder cadence (days)</Label>
                <Input
                  id="cadence"
                  name="reminder_cadence_days"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={s.reminder_cadence_days}
                />
                <p className="text-muted-foreground text-xs">
                  Minimum days between reminders for the same invoice.
                </p>
              </div>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Locker rooms &amp; displays</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="lead">Lead time (minutes)</Label>
                <Input
                  id="lead"
                  name="locker_lead_minutes"
                  type="number"
                  min={0}
                  max={480}
                  defaultValue={s.locker_lead_minutes}
                />
                <p className="text-muted-foreground text-xs">
                  How early a team gets its room before the ice slot.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="vacate">Vacate time (minutes)</Label>
                <Input
                  id="vacate"
                  name="locker_vacate_minutes"
                  type="number"
                  min={0}
                  max={480}
                  defaultValue={s.locker_vacate_minutes}
                />
                <p className="text-muted-foreground text-xs">
                  How long they keep it afterwards.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="refresh">Display refresh (seconds)</Label>
                <Input
                  id="refresh"
                  name="display_refresh_seconds"
                  type="number"
                  min={15}
                  max={3600}
                  defaultValue={s.display_refresh_seconds}
                />
                <p className="text-muted-foreground text-xs">
                  How often a lobby screen re-checks for changes.
                </p>
              </div>
            </div>
          </fieldset>

          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
