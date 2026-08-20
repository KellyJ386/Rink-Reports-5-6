"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { wallTimeToUtc, utcToWallTime } from "@/lib/timezone"

import {
  cancelBooking,
  createBooking,
  previewRate,
  quickCreateCustomer,
  updateBooking,
} from "../actions"
import type { RateQuote } from "../_lib/rate-engine"
import type {
  BookingConflict,
  BookingTypeRow,
  BookingView,
  CustomerRow,
  RinkRow,
} from "../_lib/types"

type SheetState =
  | { mode: "create"; rinkId: string; dayKey: string; startMinute: number }
  | { mode: "edit"; booking: BookingView }

type Props = {
  state: SheetState
  rinks: RinkRow[]
  bookingTypes: BookingTypeRow[]
  customers: CustomerRow[]
  timeZone: string | null
  slotMinutes: number
  canCreate: boolean
  canEdit: boolean
  onClose: () => void
}

/** "HH:MM" from minutes past midnight. */
function hm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

export function BookingSheet(props: Props) {
  const { state, rinks, bookingTypes, customers, timeZone, canEdit, onClose } = props
  const isEdit = state.mode === "edit"
  const booking = isEdit ? state.booking : null

  // Every field below is facility-LOCAL wall clock. The single conversion to
  // UTC happens in toIso() at the save boundary, mirroring the admin
  // scheduling board's convention of converting once, at persist time.
  const initialDayKey = isEdit
    ? (utcToWallTime(booking!.starts_at, timeZone)?.slice(0, 10) ?? state.mode)
    : state.dayKey
  const initialStart = isEdit
    ? (utcToWallTime(booking!.starts_at, timeZone)?.slice(11, 16) ?? "12:00")
    : hm(state.startMinute)
  const initialEnd = isEdit
    ? (utcToWallTime(booking!.ends_at, timeZone)?.slice(11, 16) ?? "13:00")
    : hm(state.startMinute + Math.max(30, props.slotMinutes * 2))

  const [dayKey, setDayKey] = useState(initialDayKey)
  const [startTime, setStartTime] = useState(initialStart)
  const [endTime, setEndTime] = useState(initialEnd)
  const [rinkId, setRinkId] = useState(isEdit ? booking!.rink_id : state.rinkId)
  const [typeId, setTypeId] = useState(
    isEdit ? booking!.booking_type_id : (bookingTypes[0]?.id ?? ""),
  )
  const [customerId, setCustomerId] = useState<string>(
    isEdit ? (booking!.customer_id ?? "") : "",
  )
  const [title, setTitle] = useState(isEdit ? (booking!.title ?? "") : "")
  const [notes, setNotes] = useState(isEdit ? (booking!.notes ?? "") : "")
  const [status, setStatus] = useState<"tentative" | "confirmed">(
    isEdit && booking!.status !== "cancelled"
      ? (booking!.status as "tentative" | "confirmed")
      : canEdit
        ? "confirmed"
        : "tentative",
  )
  const [localCustomers, setLocalCustomers] = useState(customers)
  const [quote, setQuote] = useState<RateQuote | null>(null)
  const [conflicts, setConflicts] = useState<BookingConflict[]>([])
  const [pending, startTransition] = useTransition()
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState("")

  const selectedType = bookingTypes.find((t) => t.id === typeId)
  const requiresCustomer = selectedType?.is_billable ?? true

  function toIso(day: string, time: string): string | null {
    const d = wallTimeToUtc(`${day}T${time}`, timeZone)
    return d ? d.toISOString() : null
  }

  const startsAt = toIso(dayKey, startTime)
  const endsAt = toIso(dayKey, endTime)

  // Live rate preview, resolved on the SERVER so the browser never holds the
  // rate cards and the number shown is the number that will be saved.
  useEffect(() => {
    // No synchronous setState here: an incomplete form is handled by deriving
    // `shownQuote` below rather than clearing state during the effect, which
    // React 19 flags as a cascading render.
    if (!startsAt || !endsAt || !typeId) return
    let cancelledEffect = false
    void (async () => {
      const r = await previewRate({
        startsAt,
        endsAt,
        bookingTypeId: typeId,
        customerId: customerId || null,
      })
      if (!cancelledEffect) setQuote(r.ok ? r.quote : null)
    })()
    return () => {
      cancelledEffect = true
    }
  }, [startsAt, endsAt, typeId, customerId])

  // A stale quote must not survive an edit that made the form incomplete.
  const shownQuote = startsAt && endsAt && typeId ? quote : null

  const durationLabel = useMemo(() => {
    if (!startsAt || !endsAt) return null
    const mins = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000
    if (mins <= 0) return null
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m === 0 ? `${h}h` : h === 0 ? `${m}m` : `${h}h ${m}m`
  }, [startsAt, endsAt])

  function onSave() {
    if (!startsAt || !endsAt) {
      toast.error("Enter a valid date and time.")
      return
    }
    if (requiresCustomer && !customerId) {
      toast.error("This booking type is billable, so it needs a customer.")
      return
    }

    setConflicts([])
    startTransition(async () => {
      const payload = {
        rinkId,
        customerId: customerId || null,
        bookingTypeId: typeId,
        title: title.trim() || null,
        startsAt,
        endsAt,
        status,
        notes: notes.trim() || null,
      }
      const r = isEdit
        ? await updateBooking({ ...payload, id: booking!.id })
        : await createBooking(payload)

      if (!r.ok) {
        toast.error(r.error)
        if (r.conflicts?.length) setConflicts(r.conflicts)
        return
      }
      toast.success(isEdit ? "Booking updated." : "Booking created.")
      onClose()
    })
  }

  function onQuickCustomer() {
    const name = window.prompt("New customer name")
    if (!name) return
    startTransition(async () => {
      const r = await quickCreateCustomer(name)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setLocalCustomers((prev) =>
        [...prev, { id: r.id, name: r.name, is_active: true, default_rate_card_id: null } as CustomerRow].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      )
      setCustomerId(r.id)
      toast.success("Customer added.")
    })
  }

  function onConfirmCancel() {
    if (!booking) return
    startTransition(async () => {
      const r = await cancelBooking(booking.id, cancelReason)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Booking cancelled.")
      onClose()
    })
  }

  return (
    <div
      className="bg-background/80 fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit booking" : "New booking"}
    >
      <div className="bg-card max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-xl border shadow-lg sm:rounded-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{isEdit ? "Booking" : "New booking"}</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {isEdit && booking!.status === "cancelled" && (
            <p className="border-border bg-muted/40 rounded-md border p-3 text-sm">
              This booking was cancelled
              {booking!.cancellation_reason
                ? `: ${booking!.cancellation_reason}`
                : "."}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-rink">Rink</Label>
              <select
                id="bk-rink"
                value={rinkId}
                onChange={(e) => setRinkId(e.target.value)}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                {rinks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-type">Booking type</Label>
              <select
                id="bk-type"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                {bookingTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.is_billable ? "" : " (not billed)"}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-date">Date</Label>
              <Input
                id="bk-date"
                type="date"
                value={dayKey}
                onChange={(e) => setDayKey(e.target.value)}
              />
            </div>

            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="bk-start">Start</Label>
                <Input
                  id="bk-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="bk-end">End</Label>
                <Input
                  id="bk-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="bk-customer">
                  Customer{" "}
                  {!requiresCustomer && (
                    <span className="text-muted-foreground text-xs">
                      (optional for this type)
                    </span>
                  )}
                </Label>
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onQuickCustomer}
                    disabled={pending}
                  >
                    New customer
                  </Button>
                )}
              </div>
              <select
                id="bk-customer"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                <option value="">
                  {requiresCustomer ? "Select a customer…" : "None"}
                </option>
                {localCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="bk-title">Title (optional)</Label>
              <Input
                id="bk-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Squirt A practice"
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="bk-notes">Notes</Label>
              <Textarea
                id="bk-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <fieldset className="flex flex-col gap-1 sm:col-span-2">
              <legend className="text-sm font-medium">Status</legend>
              <div className="flex gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="bk-status"
                    checked={status === "tentative"}
                    onChange={() => setStatus("tentative")}
                  />
                  Tentative
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="bk-status"
                    checked={status === "confirmed"}
                    onChange={() => setStatus("confirmed")}
                    disabled={!canEdit}
                  />
                  Confirmed
                  {!canEdit && (
                    <span className="text-muted-foreground text-xs">
                      (needs edit permission)
                    </span>
                  )}
                </label>
              </div>
            </fieldset>
          </div>

          <RatePreview quote={shownQuote} durationLabel={durationLabel} />

          {conflicts.length > 0 && <ConflictList conflicts={conflicts} />}

          {cancelling ? (
            <div className="border-destructive/40 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="bk-cancel-reason">Reason for cancelling</Label>
              <Input
                id="bk-cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ice plant repair"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={onConfirmCancel}
                  disabled={pending || !cancelReason.trim()}
                >
                  {pending ? "Cancelling…" : "Cancel booking"}
                </Button>
                <Button variant="outline" onClick={() => setCancelling(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={onSave} disabled={pending}>
                {pending ? "Saving…" : isEdit ? "Save changes" : "Create booking"}
              </Button>
              {isEdit && canEdit && booking!.status !== "cancelled" && (
                <Button variant="destructive" onClick={() => setCancelling(true)}>
                  Cancel booking…
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Shows the arithmetic, not just a total — a slot straddling prime time is
 *  two line items and the customer will be asked about exactly that. */
function RatePreview({
  quote,
  durationLabel,
}: {
  quote: RateQuote | null
  durationLabel: string | null
}) {
  if (!quote) return null

  if (quote.problem) {
    return (
      <p className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
        {quote.problem}
      </p>
    )
  }

  if (quote.segments.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border p-3 text-sm">
        {durationLabel ? `${durationLabel} of ice. ` : ""}This booking type is not
        billed, so nothing will be invoiced.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Rate preview</span>
        {quote.rateCardName && (
          <span className="text-muted-foreground text-xs">
            {quote.rateCardName}
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {quote.segments.map((s, i) => (
          <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {s.isPrime ? "Prime" : "Non-prime"}
            </span>
            <span className="font-mono text-xs tabular-nums">
              {Number(s.hours.toFixed(2))} h × ${s.hourlyRate.toFixed(2)}
            </span>
            <span className="font-mono text-sm tabular-nums">
              ${s.amount.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-baseline justify-between border-t pt-1">
        <span className="text-sm font-medium">
          Total{durationLabel ? ` · ${durationLabel}` : ""}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums">
          ${quote.totalAmount.toFixed(2)}
        </span>
      </div>
      {quote.allPrime === null && quote.segments.length > 1 && (
        <p className="text-muted-foreground text-xs">
          This slot crosses a prime-time boundary, so it is billed at both rates.
        </p>
      )}
    </div>
  )
}

/** The database refused the slot. Show what it collided with, in the rink's
 *  own local time, so the user can pick a different window. */
function ConflictList({ conflicts }: { conflicts: BookingConflict[] }) {
  return (
    <div className="border-destructive/40 flex flex-col gap-2 rounded-md border p-3">
      <p className="text-sm font-medium">Already booked</p>
      <ul className="flex flex-col gap-1">
        {conflicts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{c.rinkName}</Badge>
            <span className="font-mono text-xs tabular-nums">
              {new Date(c.startsAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
              {" – "}
              {new Date(c.endsAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {c.customerName ?? c.title}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        The resurfacing buffer counts as occupied ice, so a slot can clash even
        when the times themselves do not touch.
      </p>
    </div>
  )
}
