"use client"

import { useEffect, useState } from "react"

import { useHydrated } from "@/components/app/local-datetime"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Display-only date + time for forms whose occurred_at is auto-captured
 * (stamped at submit time — hook for offline, server for online). Deferred
 * until hydration so the SSR pass and the client agree, then ticked so the
 * shown time stays honest if the form sits open before submitting.
 */
export function AutoTimestampField() {
  const hydrated = useHydrated()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // The text is blank until hydration, so the server-rendered Date never
  // reaches the DOM and can't mismatch the client's.
  const text = hydrated
    ? now.toLocaleString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : ""

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="auto_timestamp">Date &amp; Time</Label>
      <Input
        id="auto_timestamp"
        type="text"
        value={text}
        disabled
        className="h-12 text-base"
      />
      <p className="text-sm text-muted-foreground">
        Recorded automatically when you submit.
      </p>
    </div>
  )
}
