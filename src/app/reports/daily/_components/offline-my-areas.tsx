"use client"

// Offline-capable "My Areas Today" view (D9). Online, it fetches the resolved
// model through the same server action the landing page uses (RLS-scoped) and
// snapshots it per-user into IndexedDB; offline, it renders the last snapshot
// — but ONLY if that snapshot is still for the current facility-local
// business date (assignments are per-day, so yesterday's snapshot must not
// masquerade as today's). The hosting page shell is data-free so the service
// worker can cache it for offline navigation on shared devices.
//
// Read-only by design: assignment changes and checklist submission are not
// available from this view. Completing a tab offline still works through the
// already-open daily console (its offline submit queue is unchanged).

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Circle, WifiOff } from "lucide-react"

import {
  getMyAreas,
  isCacheForToday,
  putMyAreas,
  type CachedAreaStatus,
  type CachedMyAreas,
} from "@/lib/offline/daily-areas-cache"
import { createClient } from "@/lib/supabase/client"

import { getMyAreasTodayAction } from "../assignment-actions"

type View =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_cache" }
  | { kind: "stale"; businessDate: string }
  | { kind: "routing_off" }
  | {
      kind: "ready"
      myAreas: CachedAreaStatus[]
      openAreas: CachedAreaStatus[]
      source: "live" | "cache"
      cachedAt: number | null
    }

function AreaList({
  title,
  areas,
  empty,
}: {
  title: string
  areas: CachedAreaStatus[]
  empty: string
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {areas.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          {areas.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 border-b border-border border-l-[3px] px-3.5 py-3 last:border-b-0"
              style={{ borderLeftColor: a.color?.trim() || "var(--module-daily)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-foreground">
                  {a.name}
                </div>
                {a.templatesTotal > 1 ? (
                  <div className="mt-[3px] text-[11.5px] tabular-nums text-muted-foreground">
                    {a.templatesDone}/{a.templatesTotal} shifts submitted
                  </div>
                ) : null}
              </div>
              {a.done ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Done
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
                  <Circle className="h-3 w-3" aria-hidden />
                  Not started
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function OfflineMyAreas() {
  const [view, setView] = useState<View>({ kind: "loading" })

  const load = useCallback(async () => {
    const supabase = createClient()
    // getSession reads the locally-stored session (no network), so the cache
    // key resolves even when offline.
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    if (!userId) {
      setView({ kind: "signed_out" })
      return
    }

    const renderFromCache = async () => {
      const cached = await getMyAreas(userId)
      if (!cached) {
        setView({ kind: "no_cache" })
        return
      }
      if (!isCacheForToday(cached)) {
        setView({ kind: "stale", businessDate: cached.businessDate })
        return
      }
      if (!cached.routingEnabled) {
        setView({ kind: "routing_off" })
        return
      }
      setView({
        kind: "ready",
        myAreas: cached.myAreas,
        openAreas: cached.openAreas,
        source: "cache",
        cachedAt: cached.cachedAt,
      })
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await renderFromCache()
      return
    }

    try {
      const result = await getMyAreasTodayAction()
      if (!result.ok) {
        await renderFromCache()
        return
      }
      const data = result.data
      const record: CachedMyAreas = {
        userId,
        timezone: data.timezone,
        businessDate: data.date,
        routingEnabled: data.routingEnabled,
        myAreas: data.myAreas,
        openAreas: data.openAreas,
        cachedAt: Date.now(),
      }
      await putMyAreas(record)
      if (!data.routingEnabled) {
        setView({ kind: "routing_off" })
        return
      }
      setView({
        kind: "ready",
        myAreas: data.myAreas,
        openAreas: data.openAreas,
        source: "live",
        cachedAt: null,
      })
    } catch {
      // Network/permission hiccup — fall back to whatever we snapshotted last.
      await renderFromCache()
    }
  }, [])

  useEffect(() => {
    // Fetch-on-mount + refetch when the connection returns; setState only
    // happens after awaits (same pattern as OfflineMySchedule).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load; setState happens post-await
    void load()
    const onOnline = () => void load()
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [load])

  if (view.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Loading your areas…</p>
  }

  if (view.kind === "signed_out") {
    return (
      <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
        <p>Sign in to view your areas.</p>
        <Link
          href="/login"
          className="mt-2 inline-block font-semibold text-primary hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    )
  }

  if (view.kind === "no_cache") {
    return (
      <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
        Your areas aren&apos;t downloaded yet. Open Daily Reports (or this page)
        once while online to make them available offline.
      </div>
    )
  }

  if (view.kind === "stale") {
    return (
      <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
        Your saved areas are from {view.businessDate} — a previous day.
        Assignments change daily, so reconnect to load today&apos;s.
      </div>
    )
  }

  if (view.kind === "routing_off") {
    return (
      <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
        Area assignment isn&apos;t enabled for your facility — every area is
        open. Use{" "}
        <Link
          href="/reports/daily"
          className="font-semibold text-primary hover:underline"
        >
          Daily Reports
        </Link>{" "}
        while online.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {view.source === "cache" ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-muted-foreground"
        >
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Offline — showing your last-synced areas. Completion states may be
            behind; assignment changes need a connection.
          </span>
        </div>
      ) : null}

      <AreaList
        title="My areas today"
        areas={view.myAreas}
        empty="No areas assigned to you today."
      />
      <AreaList
        title="Open areas"
        areas={view.openAreas}
        empty="No open areas today."
      />
    </div>
  )
}
