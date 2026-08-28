"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { hhmmToMinute } from "@/lib/rink-scheduling/booking-request"

type Props = {
  token: string
  rinks: Array<{ id: string; name: string }>
  /** Facility-local today ("YYYY-MM-DD") — the earliest requestable date. */
  todayKey: string
}

/**
 * The public form body. Times are converted to minutes-past-local-midnight
 * with the same pure helper the API validates with; an end at or before the
 * start is treated as past midnight (11:00 PM – 1:00 AM), which the schema
 * allows up to 4:00 AM.
 */
export function RequestIceForm({ token, rinks, todayKey }: Props) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [organization, setOrganization] = useState("")
  const [rinkId, setRinkId] = useState("")
  const [date, setDate] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [purpose, setPurpose] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const startMinute = hhmmToMinute(startTime)
    const endRaw = hhmmToMinute(endTime)
    if (startMinute === null) {
      setError("Choose a start time.")
      return
    }
    if (endRaw === null) {
      setError("Choose an end time.")
      return
    }
    // Only an end at or before the start rolls to the next day — a plain
    // evening slot is left exactly as picked.
    const endMinute = endRaw <= startMinute ? endRaw + 1440 : endRaw

    setSubmitting(true)
    try {
      const res = await fetch("/api/rink-booking-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          requesterName: name,
          requesterEmail: email,
          requesterPhone: phone || null,
          organization: organization || null,
          rinkId: rinkId || null,
          requestedDate: date,
          startMinute,
          endMinute,
          purpose: purpose || null,
        }),
      })
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null
      if (body?.ok) {
        setSentTo(email.trim())
      } else {
        setError(
          body?.error ?? "Something went wrong sending your request. Try again.",
        )
      }
    } catch {
      setError("Could not send your request. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 py-6">
          <h2 className="text-lg font-semibold tracking-tight">Request received</h2>
          <p className="text-muted-foreground text-sm">
            Thanks — the rink will review your request and get back to you at{" "}
            <span className="text-foreground font-medium">{sentTo}</span>.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardContent className="flex flex-col gap-4 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ri-name">
                Your name <span aria-hidden="true">*</span>
              </Label>
              <Input
                id="ri-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                autoComplete="name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ri-email">
                Email <span aria-hidden="true">*</span>
              </Label>
              <Input
                id="ri-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ri-phone">Phone</Label>
              <Input
                id="ri-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
                autoComplete="tel"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ri-org">Team or organization</Label>
              <Input
                id="ri-org"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                maxLength={160}
                autoComplete="organization"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ri-rink">Rink</Label>
              <select
                id="ri-rink"
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
              <Label htmlFor="ri-date">
                Date <span aria-hidden="true">*</span>
              </Label>
              <Input
                id="ri-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                min={todayKey}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ri-start">
                Start time <span aria-hidden="true">*</span>
              </Label>
              <Input
                id="ri-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ri-end">
                End time <span aria-hidden="true">*</span>
              </Label>
              <Input
                id="ri-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
              <p className="text-muted-foreground text-xs">
                End before start means past midnight — e.g. 11:00 PM to 1:00 AM.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ri-purpose">Anything else we should know?</Label>
            <Textarea
              id="ri-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Practice, game, party, skill level, how often…"
            />
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send request"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
