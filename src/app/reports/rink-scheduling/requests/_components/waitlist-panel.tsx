"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { hhmmToMinute } from "@/lib/rink-scheduling/booking-request"

import { addWaitlistEntry, resolveWaitlistEntry } from "../../request-actions"

export type WaitlistEntryView = {
  id: string
  who: string
  phone: string | null
  dateLong: string
  windowLabel: string
  rinkName: string | null
  notes: string | null
}

type Props = {
  entries: WaitlistEntryView[]
  customers: Array<{ id: string; name: string }>
  rinks: Array<{ id: string; name: string }>
  todayKey: string
}

export function WaitlistPanel({ entries, customers, rinks, todayKey }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <AddEntryForm customers={customers} rinks={rinks} todayKey={todayKey} />

      {entries.length === 0 ? (
        <EmptyState
          title="Nobody is waiting"
          description="Add customers who want ice on a date so the desk knows who to call when a slot frees up."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <ul className="divide-border divide-y">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AddEntryForm({
  customers,
  rinks,
  todayKey,
}: {
  customers: Array<{ id: string; name: string }>
  rinks: Array<{ id: string; name: string }>
  todayKey: string
}) {
  const [customerId, setCustomerId] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [rinkId, setRinkId] = useState("")
  const [desiredDate, setDesiredDate] = useState(todayKey)
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [notes, setNotes] = useState("")
  const [pending, startTransition] = useTransition()

  function onAdd() {
    if (!customerId && !contactName.trim()) {
      toast.error("Pick a customer or enter a contact name.")
      return
    }
    if (!desiredDate) {
      toast.error("Pick a date.")
      return
    }

    // The window is optional, but comes as a pair. An end at or before the
    // start means past midnight, mirroring the request form.
    let startMinute: number | null = null
    let endMinute: number | null = null
    if (startTime || endTime) {
      const start = hhmmToMinute(startTime)
      const end = hhmmToMinute(endTime)
      if (start === null || end === null) {
        toast.error("Enter both a start and an end time, or leave both blank.")
        return
      }
      startMinute = start
      endMinute = end <= start ? end + 1440 : end
    }

    startTransition(async () => {
      const r = await addWaitlistEntry({
        customerId: customerId || null,
        contactName: contactName.trim() || null,
        contactPhone: contactPhone.trim() || null,
        rinkId: rinkId || null,
        desiredDate,
        startMinute,
        endMinute,
        notes: notes.trim() || null,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Added to the waitlist.")
      setContactName("")
      setContactPhone("")
      setStartTime("")
      setEndTime("")
      setNotes("")
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <h2 className="text-sm font-semibold tracking-tight">Add to the waitlist</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="wl-customer">Customer</Label>
            <select
              id="wl-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
            >
              <option value="">None — use a contact name</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="wl-name">Contact name</Label>
            <Input
              id="wl-name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="If they are not a customer yet"
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="wl-phone">Phone</Label>
            <Input
              id="wl-phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="wl-rink">Rink</Label>
            <select
              id="wl-rink"
              value={rinkId}
              onChange={(e) => setRinkId(e.target.value)}
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
            >
              <option value="">Any rink</option>
              {rinks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="wl-date">Date</Label>
            <Input
              id="wl-date"
              type="date"
              value={desiredDate}
              onChange={(e) => setDesiredDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="wl-start">From (optional)</Label>
              <Input
                id="wl-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="wl-end">To</Label>
              <Input
                id="wl-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="wl-notes">Notes (optional)</Label>
          <Textarea
            id="wl-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
          />
        </div>

        <div>
          <Button onClick={onAdd} disabled={pending}>
            {pending ? "Adding…" : "Add to waitlist"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EntryRow({ entry }: { entry: WaitlistEntryView }) {
  const [pending, startTransition] = useTransition()

  function onResolve(status: "fulfilled" | "cancelled") {
    startTransition(async () => {
      const r = await resolveWaitlistEntry(entry.id, status)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(
        status === "fulfilled" ? "Marked fulfilled." : "Removed from the waitlist.",
      )
    })
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {entry.who}
          {entry.phone ? (
            <span className="text-muted-foreground font-normal"> · {entry.phone}</span>
          ) : null}
        </p>
        <p className="text-muted-foreground text-sm">
          {entry.dateLong} · {entry.windowLabel} · {entry.rinkName ?? "Any rink"}
        </p>
        {entry.notes ? (
          <p className="text-muted-foreground text-xs whitespace-pre-wrap">
            {entry.notes}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onResolve("fulfilled")}
          disabled={pending}
        >
          Fulfilled
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onResolve("cancelled")}
          disabled={pending}
        >
          Remove
        </Button>
      </div>
    </li>
  )
}
