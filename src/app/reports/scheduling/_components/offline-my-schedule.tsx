"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { WifiOff } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import {
  getMySchedule,
  putMySchedule,
  shiftsInWindow,
  type CachedShift,
} from "@/lib/offline/schedule-cache"

import { formatDateRange, formatRelativeAge } from "./format-utils"

type View =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_cache" }
  | {
      kind: "ready"
      shifts: CachedShift[]
      timezone: string | null
      source: "live" | "cache"
      cachedAtIso: string | null
    }

const WINDOW_BACK_MS = 1 * 24 * 60 * 60 * 1000
const WINDOW_FWD_MS = 30 * 24 * 60 * 60 * 1000

const statusColors: Record<string, string> = {
  published: "#1F6B00",
  cancelled: "#9DB2C8",
  draft: "#0EA5E9",
}

function windowBounds() {
  const now = Date.now()
  return { fromMs: now - WINDOW_BACK_MS, toMs: now + WINDOW_FWD_MS }
}

/**
 * Offline-capable "my shifts" view. Online, it fetches the signed-in
 * employee's own published shifts (RLS-scoped) and caches them per-user in
 * IndexedDB; offline, it renders the last cached copy. The page shell that
 * hosts this component is intentionally data-free so the service worker can
 * cache it without leaking user data on a shared device.
 */
export function OfflineMySchedule() {
  const [view, setView] = useState<View>({ kind: "loading" })

  const load = useCallback(async () => {
    const supabase = createClient()
    // getSession reads the locally-stored session (no network), so we can key
    // the cache by the current user even when offline.
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    if (!userId) {
      setView({ kind: "signed_out" })
      return
    }

    const { fromMs, toMs } = windowBounds()

    const renderFromCache = async () => {
      const cached = await getMySchedule(userId)
      if (!cached) {
        setView({ kind: "no_cache" })
        return
      }
      setView({
        kind: "ready",
        shifts: shiftsInWindow(cached.shifts, fromMs, toMs),
        timezone: cached.timezone,
        source: "cache",
        cachedAtIso: new Date(cached.cachedAt).toISOString(),
      })
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await renderFromCache()
      return
    }

    try {
      const { data: emp } = await supabase
        .from("employees")
        .select("id, facility_id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle()
      if (!emp) {
        await renderFromCache()
        return
      }

      const { data: facility } = await supabase
        .from("facilities")
        .select("timezone")
        .eq("id", emp.facility_id)
        .maybeSingle<{ timezone: string | null }>()
      const timezone = facility?.timezone ?? null

      const { data: rows, error } = await supabase
        .from("schedule_shifts")
        .select(
          "id, starts_at, ends_at, role_label, status, department_id, departments(name)"
        )
        .eq("employee_id", emp.id)
        .eq("status", "published")
        .gte("starts_at", new Date(fromMs).toISOString())
        .lte("starts_at", new Date(toMs).toISOString())
        .order("starts_at", { ascending: true })
      if (error) throw error

      const shifts = (rows ?? []) as unknown as CachedShift[]
      await putMySchedule({
        userId,
        employeeId: emp.id,
        timezone,
        shifts,
        cachedAt: Date.now(),
      })
      setView({
        kind: "ready",
        shifts,
        timezone,
        source: "live",
        cachedAtIso: null,
      })
    } catch {
      // Network/permission hiccup — fall back to whatever we cached last.
      await renderFromCache()
    }
  }, [])

  useEffect(() => {
    // Fetch-on-mount + refetch when the connection returns. `load` only calls
    // setState after awaiting the session/network, so there is no synchronous
    // cascade — but the rule can't see past the await, so disable it here.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load; setState happens post-await
    void load()
    const onOnline = () => void load()
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [load])

  if (view.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Loading your schedule…</p>
  }

  if (view.kind === "signed_out") {
    return (
      <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
        <p>Sign in to view your schedule.</p>
        <Link href="/login" className="mt-2 inline-block font-semibold text-primary hover:underline">
          Go to sign in
        </Link>
      </div>
    )
  }

  if (view.kind === "no_cache") {
    return (
      <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
        Your schedule isn&apos;t downloaded yet. Open this page once while online
        to make it available offline.
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
            Offline — showing your last-synced schedule
            {view.cachedAtIso ? ` (as of ${formatRelativeAge(view.cachedAtIso)})` : ""}.
          </span>
        </div>
      ) : null}

      {view.shifts.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
          No upcoming published shifts.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          {view.shifts.map((s, i) => {
            const color = statusColors[s.status] ?? "#9DB2C8"
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 px-[14px] py-3"
                style={{
                  borderBottom:
                    i < view.shifts.length - 1 ? "1px solid var(--border)" : "none",
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-foreground">
                    {formatDateRange(s.starts_at, s.ends_at, view.timezone)}
                  </div>
                  <div className="mt-[3px] flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] text-muted-foreground">
                      {s.departments?.name ?? "—"}
                    </span>
                    {s.role_label ? (
                      <span className="text-[11.5px] text-muted-foreground">
                        · {s.role_label}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
