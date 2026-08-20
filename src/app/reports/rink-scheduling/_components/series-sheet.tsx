"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { createSeries, previewSeries, type OccurrencePreview } from "../series-actions"
import { describeRecurrence, type OccurrenceResolution } from "../_lib/series"
import type { BookingTypeRow, CustomerRow, RinkRow } from "../_lib/types"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type Props = {
  rinks: RinkRow[]
  bookingTypes: BookingTypeRow[]
  customers: CustomerRow[]
  defaultDayKey: string
  canEdit: boolean
  onClose: () => void
}

/**
 * Two-step by design: nothing is written until the whole expansion has been
 * reviewed. A recurring contract can be thirty-plus bookings, and finding out
 * afterwards that week twelve clashed is far worse than seeing it first.
 */
export function SeriesSheet({
  rinks,
  bookingTypes,
  customers,
  defaultDayKey,
  canEdit,
  onClose,
}: Props) {
  const [rinkId, setRinkId] = useState(rinks[0]?.id ?? "")
  const [typeId, setTypeId] = useState(bookingTypes[0]?.id ?? "")
  const [customerId, setCustomerId] = useState("")
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [status, setStatus] = useState<"tentative" | "confirmed">("confirmed")
  const [days, setDays] = useState<number[]>([])
  const [startTime, setStartTime] = useState("18:00")
  const [endTime, setEndTime] = useState("20:00")
  const [startDate, setStartDate] = useState(defaultDayKey)
  const [endDate, setEndDate] = useState(defaultDayKey)
  const [intervalWeeks, setIntervalWeeks] = useState(1)

  const [preview, setPreview] = useState<OccurrencePreview[] | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, OccurrenceResolution>>({})
  const [pending, startTransition] = useTransition()

  const recurrence = {
    daysOfWeek: days,
    startTime,
    endTime,
    seriesStartDate: startDate,
    seriesEndDate: endDate,
    intervalWeeks,
  }

  const selectedType = bookingTypes.find((t) => t.id === typeId)
  const requiresCustomer = selectedType?.is_billable ?? true

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
    setPreview(null)
  }

  function onPreview() {
    startTransition(async () => {
      const r = await previewSeries({
        rinkId,
        bookingTypeId: typeId,
        customerId: customerId || null,
        recurrence,
      })
      if (!r.ok) {
        toast.error(r.error)
        setPreview(null)
        return
      }
      setPreview(r.occurrences)
      // Conflicted dates default to SKIP: the safe choice, and the one that
      // needs no further thought if the user just wants the rest booked.
      const defaults: Record<string, OccurrenceResolution> = {}
      for (const o of r.occurrences) {
        defaults[o.dayKey] = o.conflictWith ? { kind: "skip" } : { kind: "book" }
      }
      setResolutions(defaults)
    })
  }

  function onCommit() {
    if (requiresCustomer && !customerId) {
      toast.error("This booking type is billable, so the series needs a customer.")
      return
    }
    startTransition(async () => {
      const r = await createSeries({
        rinkId,
        bookingTypeId: typeId,
        customerId: customerId || null,
        title: title.trim() || null,
        notes: notes.trim() || null,
        status,
        recurrence,
        resolutions,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      const parts = [`${r.created} booking${r.created === 1 ? "" : "s"} created`]
      if (r.skipped > 0) parts.push(`${r.skipped} skipped`)
      if (r.failed.length > 0) {
        parts.push(`${r.failed.length} could not be booked (${r.failed.join(", ")})`)
      }
      toast.success(parts.join(", ") + ".")
      onClose()
    })
  }

  const conflictCount = preview?.filter((o) => o.conflictWith).length ?? 0
  const bookingCount =
    preview?.filter((o) => (resolutions[o.dayKey]?.kind ?? "book") !== "skip").length ?? 0
  const total =
    preview
      ?.filter((o) => (resolutions[o.dayKey]?.kind ?? "book") !== "skip")
      .reduce((sum, o) => sum + (o.amount ?? 0), 0) ?? 0

  return (
    <div
      className="bg-background/80 fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New recurring series"
    >
      <div className="bg-card max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl border shadow-lg sm:rounded-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">New recurring series</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {!canEdit && (
            <p className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
              Creating a recurring series needs the Rink Scheduling edit
              permission.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sr-rink">Rink</Label>
              <select
                id="sr-rink"
                value={rinkId}
                onChange={(e) => {
                  setRinkId(e.target.value)
                  setPreview(null)
                }}
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
              <Label htmlFor="sr-type">Booking type</Label>
              <select
                id="sr-type"
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value)
                  setPreview(null)
                }}
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

            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="sr-customer">
                Customer{" "}
                {!requiresCustomer && (
                  <span className="text-muted-foreground text-xs">
                    (optional for this type)
                  </span>
                )}
              </Label>
              <select
                id="sr-customer"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value)
                  setPreview(null)
                }}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                <option value="">
                  {requiresCustomer ? "Select a customer…" : "None"}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Repeats on</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((name, d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={days.includes(d) ? "default" : "outline"}
                  onClick={() => toggleDay(d)}
                  aria-pressed={days.includes(d)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="sr-start-time">Start</Label>
                <Input
                  id="sr-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value)
                    setPreview(null)
                  }}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="sr-end-time">End</Label>
                <Input
                  id="sr-end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value)
                    setPreview(null)
                  }}
                />
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="sr-from">From</Label>
                <Input
                  id="sr-from"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    setPreview(null)
                  }}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="sr-to">Until</Label>
                <Input
                  id="sr-to"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value)
                    setPreview(null)
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="sr-interval">Repeat every</Label>
              <select
                id="sr-interval"
                value={intervalWeeks}
                onChange={(e) => {
                  setIntervalWeeks(Number(e.target.value))
                  setPreview(null)
                }}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                <option value={1}>Week</option>
                <option value={2}>2 weeks</option>
                <option value={3}>3 weeks</option>
                <option value={4}>4 weeks</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sr-title">Title (optional)</Label>
              <Input
                id="sr-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Bantam A practice"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sr-notes">Notes</Label>
              <Textarea
                id="sr-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={1}
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Status</legend>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="sr-status"
                  checked={status === "tentative"}
                  onChange={() => setStatus("tentative")}
                />
                Tentative
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="sr-status"
                  checked={status === "confirmed"}
                  onChange={() => setStatus("confirmed")}
                />
                Confirmed
              </label>
            </div>
          </fieldset>

          {days.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {describeRecurrence(recurrence)}
            </p>
          )}

          {preview === null ? (
            <div>
              <Button onClick={onPreview} disabled={pending || !canEdit || days.length === 0}>
                {pending ? "Checking…" : "Preview dates"}
              </Button>
            </div>
          ) : (
            <>
              <OccurrenceTable
                occurrences={preview}
                resolutions={resolutions}
                onChange={(dayKey, resolution) =>
                  setResolutions((prev) => ({ ...prev, [dayKey]: resolution }))
                }
              />

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="text-sm">
                  <span className="font-medium">{bookingCount}</span> of{" "}
                  {preview.length} dates will be booked
                  {conflictCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-warning">
                        {conflictCount} clash with existing ice
                      </span>
                    </>
                  )}
                </div>
                <span className="font-mono text-sm tabular-nums">
                  ${total.toFixed(2)} total
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={onCommit} disabled={pending || bookingCount === 0}>
                  {pending ? "Creating…" : `Create ${bookingCount} bookings`}
                </Button>
                <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
                  Change the pattern
                </Button>
                <Button variant="outline" onClick={onClose} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Per-occurrence resolution. A conflicted date can be skipped or nudged; the
 *  clean ones need no decision, so they say so quietly. */
function OccurrenceTable({
  occurrences,
  resolutions,
  onChange,
}: {
  occurrences: OccurrencePreview[]
  resolutions: Record<string, OccurrenceResolution>
  onChange: (dayKey: string, resolution: OccurrenceResolution) => void
}) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {occurrences.map((o) => {
            const resolution = resolutions[o.dayKey] ?? { kind: "book" }
            const skipped = resolution.kind === "skip"
            return (
              <tr key={o.dayKey} className="border-t">
                <td className="px-3 py-1.5 font-mono text-xs tabular-nums">
                  {o.dayKey}
                </td>
                <td className="px-3 py-1.5">
                  {o.conflictWith ? (
                    <span className="text-warning text-xs">
                      clashes with {o.conflictWith}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">free</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                  {skipped ? "—" : o.amount === null ? "n/a" : `$${o.amount.toFixed(2)}`}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {skipped ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <Badge variant="secondary" className="uppercase">
                        skipped
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onChange(o.dayKey, { kind: "book" })}
                      >
                        Include
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onChange(o.dayKey, { kind: "skip" })}
                    >
                      Skip
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
