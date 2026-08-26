"use client"

import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  getCalendar,
  isFresh,
  type CachedBooking,
  type CachedCalendar,
} from "@/lib/offline/calendar-cache"
import { createClient } from "@/lib/supabase/client"
import { dayKeyInTz } from "@/lib/timezone"

type View =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_cache" }
  | { kind: "ready"; data: CachedCalendar; stale: boolean }

/**
 * Read-only offline view of the rink calendar.
 *
 * Writes are deliberately unavailable here, not merely unimplemented: booking
 * conflicts are enforced by a database exclusion constraint that re-checks at
 * insert time, so a booking queued offline could be accepted against a world
 * that has since changed. The banner says so plainly rather than showing a
 * disabled button with no explanation.
 */
export function OfflineRinkSchedule() {
  const [view, setView] = useState<View>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const supabase = createClient()
      // A local read: works with no network.
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user?.id ?? null
      if (cancelled) return
      if (!userId) {
        setView({ kind: "signed_out" })
        return
      }

      const cached = await getCalendar(userId)
      if (cancelled) return
      if (!cached) {
        setView({ kind: "no_cache" })
        return
      }
      setView({
        kind: "ready",
        data: cached,
        stale: !isFresh(cached.cachedAt, Date.now()),
      })
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (view.kind === "loading") {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  if (view.kind === "signed_out") {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm">
            Sign in to see the rink schedule. Once you have opened it online, it
            stays available here without a connection.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (view.kind === "no_cache") {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm">
            Nothing saved yet. Open the rink schedule while you have a
            connection and it will be available here afterwards.
          </p>
        </CardContent>
      </Card>
    )
  }

  const { data, stale } = view
  const timeZone = data.timeZone
  const byDay = new Map<string, CachedBooking[]>()
  for (const b of data.bookings) {
    const key = dayKeyInTz(b.startsAt, timeZone)
    byDay.set(key, [...(byDay.get(key) ?? []), b])
  }
  const dayKeys = Array.from(byDay.keys()).sort()

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm"
      >
        <p className="font-medium">
          You&rsquo;re offline — bookings can be viewed but not created or edited.
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Showing the schedule as last synced
          {stale ? " (more than a day ago)" : ""}. Reconnect to make changes.
        </p>
      </div>

      {dayKeys.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No bookings were saved for this period.
        </p>
      ) : (
        dayKeys.map((dayKey) => (
          <Card key={dayKey}>
            <CardContent className="flex flex-col gap-2 py-4">
              <h2 className="font-semibold">{dayKey}</h2>
              <ul className="flex flex-col divide-y">
                {(byDay.get(dayKey) ?? []).map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center gap-3 py-2"
                  >
                    <span className="w-32 shrink-0 font-mono text-sm tabular-nums">
                      {formatTime(b.startsAt, timeZone)} –{" "}
                      {formatTime(b.endsAt, timeZone)}
                    </span>
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-sm border"
                      style={{ backgroundColor: b.typeColor }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {b.customerName ?? b.title ?? b.typeName}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {b.rinkShortCode}
                    </span>
                    {b.status === "cancelled" && (
                      <Badge variant="secondary" className="uppercase">
                        cancelled
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

/** Always formatted with an explicit zone: the device's own zone would misstate
 *  every time for a rink in another one. */
function formatTime(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone ?? undefined,
    }).format(new Date(iso))
  } catch {
    return ""
  }
}
