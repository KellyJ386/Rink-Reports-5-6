"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useSyncExternalStore } from "react"
import {
  ArrowLeft,
  Building2,
  Clock,
  LogOut,
  Thermometer,
  User as UserIcon,
  UserCog,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SyncStatusBadge } from "@/components/offline/sync-status-badge"
import { ThemeToggle } from "@/components/app/theme-toggle"
import { AppMobileSidebar } from "@/components/app/mobile-sidebar"
import { MobileSidebar as AdminMobileSidebar } from "@/components/admin/mobile-sidebar"

// Single header used across the whole app (admin + reports). Action Green bar
// with white text, showing User · Facility · Date/Time · Temperature. The only
// per-context difference is which mobile sidebar opens and whether the sync
// badge / admin "Back to Dashboard" affordance shows.
//
// Temperature is the facility's *outdoor/local* weather (Open-Meteo, geocoded
// from city/state) — the app has no building/ice temperature feed.

type GlobalHeaderProps = {
  variant: "admin" | "staff"
  email: string | null
  fullName: string | null
  isAdmin: boolean
  facilityName: string | null
  tempF: number | null
  tempLocation: string | null
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
}

// Live clock via useSyncExternalStore. The snapshot MUST be cached — returning a
// fresh Date.now() on every read makes the store look perpetually changed and
// drives React into an infinite render loop. We mutate `clockNow` only inside
// the interval; the server snapshot is null so SSR renders a placeholder with no
// hydration mismatch.
let clockNow = Date.now()
function subscribeClock(cb: () => void) {
  const id = setInterval(() => {
    clockNow = Date.now()
    cb()
  }, 1000)
  return () => clearInterval(id)
}
function getClockSnapshot(): number {
  return clockNow
}
function getClockServerSnapshot(): number | null {
  return null
}

export function GlobalHeader({
  variant,
  email,
  fullName,
  isAdmin,
  facilityName,
  tempF,
  tempLocation,
}: GlobalHeaderProps) {
  const router = useRouter()
  const nowMs = useSyncExternalStore(
    subscribeClock,
    getClockSnapshot,
    getClockServerSnapshot,
  )
  const now = nowMs == null ? null : new Date(nowMs)

  const initials = React.useMemo(() => {
    const source = (fullName ?? email ?? "").trim()
    if (!source) return "?"
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }, [fullName, email])

  const userLabel = fullName ?? email ?? "User"
  const tempLabel =
    typeof tempF === "number"
      ? `${Math.round(tempF)}°F${tempLocation ? ` · ${tempLocation}` : ""}`
      : "Temp unavailable"

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 px-4 text-white shadow-md shadow-black/5 backdrop-saturate-150 lg:px-6 print:hidden"
      style={{
        backgroundImage:
          "linear-gradient(180deg, var(--green-400) 0%, var(--green-500) 55%, var(--green-600) 100%)",
      }}
    >
      {/* Left: mobile sidebar trigger (per-context) */}
      <div className="lg:hidden [&_button]:text-white [&_button:hover]:bg-white/15">
        {variant === "admin" ? (
          <AdminMobileSidebar email={email} fullName={fullName} />
        ) : (
          <AppMobileSidebar
            isAdmin={isAdmin}
            email={email}
            fullName={fullName}
          />
        )}
      </div>

      {/* Center: uniform context info as subtle chips — User · Facility · Date/Time · Temp */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm font-medium">
        <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-inset ring-white/15 shadow-sm">
          <UserIcon className="h-4 w-4 shrink-0 text-white/90" aria-hidden />
          <span className="truncate">{userLabel}</span>
        </span>
        {facilityName ? (
          <span className="hidden min-w-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-inset ring-white/10 sm:flex">
            <Building2 className="h-4 w-4 shrink-0 text-white/90" aria-hidden />
            <span className="truncate">{facilityName}</span>
          </span>
        ) : null}
        <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-inset ring-white/10 md:flex">
          <Clock className="h-4 w-4 shrink-0 text-white/90" aria-hidden />
          <span>{now ? formatDate(now) : "—"}</span>
          <span className="tabular-nums">{now ? formatTime(now) : ""}</span>
        </span>
        <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-inset ring-white/10 lg:flex">
          <Thermometer className="h-4 w-4 shrink-0 text-white/90" aria-hidden />
          <span>{tempLabel}</span>
        </span>
      </div>

      {/* Right: controls */}
      <div className="flex shrink-0 items-center gap-2">
        {variant === "admin" ? (
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            aria-label="Back to Dashboard"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 text-sm font-medium shadow-sm transition-colors hover:bg-white/20"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
        ) : (
          <div className="text-white">
            <SyncStatusBadge />
          </div>
        )}
        <div className="[&_button]:rounded-full [&_button]:border-white/40 [&_button]:bg-white [&_button]:shadow-sm [&_button:hover]:bg-white/90">
          <ThemeToggle />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open user menu"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-1.5 text-sm shadow-sm transition-colors hover:bg-white/20 sm:pr-3"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-[var(--green-700)] shadow-sm ring-2 ring-white/40">
              {initials}
            </span>
            <span className="hidden max-w-[160px] truncate sm:inline">
              {userLabel}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate font-semibold">
                {fullName ?? "Signed in"}
              </span>
              {email && (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {email}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/account")}>
              <UserCog className="h-4 w-4" aria-hidden />
              <span>My Account</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action="/logout" method="post">
              <DropdownMenuItem type="submit" className="w-full">
                <LogOut className="h-4 w-4" aria-hidden />
                <span>Sign out</span>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
