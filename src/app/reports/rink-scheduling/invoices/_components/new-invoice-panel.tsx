"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatMoney } from "@/lib/rink-scheduling/ar"

import {
  generateInvoice,
  listUninvoicedBookings,
  type BillableBooking,
} from "../../invoice-actions"

type Props = {
  customers: Array<{ id: string; name: string }>
  paymentMethods: Array<{ id: string; name: string }>
  todayKey: string
}

/**
 * Pick a customer and a window, see exactly what will be billed, then commit.
 *
 * The list only ever offers bookings that are billable, not cancelled, and not
 * already on a live invoice — the same rule the database's partial unique
 * index enforces, so what is offered and what is accepted cannot drift.
 */
export function NewInvoicePanel({ customers, todayKey }: Props) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState("")
  const [fromKey, setFromKey] = useState(firstOfMonth(todayKey))
  const [toKey, setToKey] = useState(todayKey)
  const [issueDate, setIssueDate] = useState(todayKey)
  const [notes, setNotes] = useState("")
  const [bookings, setBookings] = useState<BillableBooking[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  function onFind() {
    if (!customerId) {
      toast.error("Pick a customer first.")
      return
    }
    startTransition(async () => {
      const r = await listUninvoicedBookings({
        customerId,
        fromDayKey: fromKey,
        toDayKey: toKey,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setBookings(r.bookings)
      setSelected(new Set(r.bookings.map((b) => b.id)))
      if (r.bookings.length === 0) {
        toast.info("Nothing to invoice for that customer in that window.")
      }
    })
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onGenerate() {
    startTransition(async () => {
      const r = await generateInvoice({
        customerId,
        bookingIds: Array.from(selected),
        issueDate,
        notes: notes.trim() || null,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Draft ${r.number} created.`)
      router.push(`/reports/rink-scheduling/invoices/${r.invoiceId}`)
    })
  }

  const chosen = (bookings ?? []).filter((b) => selected.has(b.id))
  const subtotal = chosen.reduce((s, b) => s + (b.amount ?? 0), 0)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ni-customer">Customer</Label>
            <select
              id="ni-customer"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value)
                setBookings(null)
              }}
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
            >
              <option value="">Select…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ni-from">From</Label>
            <Input
              id="ni-from"
              type="date"
              value={fromKey}
              onChange={(e) => {
                setFromKey(e.target.value)
                setBookings(null)
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ni-to">To</Label>
            <Input
              id="ni-to"
              type="date"
              value={toKey}
              onChange={(e) => {
                setToKey(e.target.value)
                setBookings(null)
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ni-issue">Issue date</Label>
            <Input
              id="ni-issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Button onClick={onFind} disabled={pending || !customerId}>
            {pending ? "Looking…" : "Find bookings to bill"}
          </Button>
        </div>

        {bookings !== null && bookings.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="w-10 px-2 py-2"></th>
                    <th className="px-2 py-2 text-left font-medium">Date</th>
                    <th className="px-2 py-2 text-left font-medium">Booking</th>
                    <th className="px-2 py-2 text-right font-medium">Hours</th>
                    <th className="px-2 py-2 text-right font-medium">Rate</th>
                    <th className="px-2 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(b.id)}
                          onChange={() => toggle(b.id)}
                          aria-label={`Include ${b.dayKey} ${b.timeRange}`}
                          className="border-input size-4 rounded border"
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs tabular-nums">
                        {b.dayKey}
                      </td>
                      <td className="px-2 py-1.5">
                        {b.typeName} · {b.rinkName} · {b.timeRange}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                        {b.hours.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                        {b.rateSnapshot === null ? "—" : formatMoney(b.rateSnapshot)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                        {b.amount === null ? "—" : formatMoney(b.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="ni-notes">Notes on the invoice (optional)</Label>
              <Textarea
                id="ni-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <span className="text-sm">
                {chosen.length} of {bookings.length} bookings selected
              </span>
              <span className="font-mono text-sm tabular-nums">
                {formatMoney(subtotal)} before tax
              </span>
            </div>

            <div>
              <Button onClick={onGenerate} disabled={pending || chosen.length === 0}>
                {pending ? "Creating…" : "Create draft invoice"}
              </Button>
            </div>
          </>
        )}

        {bookings !== null && bookings.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Nothing uninvoiced for that customer in that window. Bookings appear
            here once they exist, are billable, are not cancelled, and are not
            already on an invoice.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function firstOfMonth(dayKey: string): string {
  return `${dayKey.slice(0, 7)}-01`
}
