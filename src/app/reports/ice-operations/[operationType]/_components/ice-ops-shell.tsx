"use client"

import Link from "next/link"
import {
  Activity,
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  Home,
  Settings,
  Thermometer,
  User,
} from "lucide-react"
import {
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react"

import { Badge } from "@/components/ui/badge"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { DataList, DataListRow } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { SectionCard } from "@/components/ui/section-card"

export type RecentActivityItem = {
  id: string
  label: string
  when: string
  rinkName: string | null
  equipmentName: string | null
  failedCount: number
}

type Props = {
  userName: string
  facilityName: string | null
  tempF: number | null
  tempLocation: string | null
  isAdmin: boolean
  configureHref: string
  recent: RecentActivityItem[]
}

function subscribeClock(cb: () => void) {
  const id = setInterval(cb, 1000)
  return () => clearInterval(id)
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function IceOpsShell({
  userName,
  facilityName,
  tempF,
  tempLocation,
  isAdmin,
  configureHref,
  recent,
}: Props) {
  const [showFeed, setShowFeed] = useState(false)

  const nowMs = useSyncExternalStore(
    subscribeClock,
    () => Date.now(),
    () => null,
  )
  const now = nowMs == null ? null : new Date(nowMs)

  const tempLabel =
    typeof tempF === "number"
      ? `${Math.round(tempF)}°F${tempLocation ? ` · ${tempLocation}` : ""}`
      : "Temp unavailable"

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        variant="display"
        module="ice-ops"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Ice Operations" },
            ]}
          />
        }
        title="Ice Operations"
        actions={
          <>
            {isAdmin ? (
              <Button asChild variant="outline" size="sm">
                <Link href={configureHref}>
                  <Settings className="h-4 w-4" />
                  Configure Forms
                </Link>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={showFeed}
              onClick={() => setShowFeed((v) => !v)}
            >
              <Activity className="h-4 w-4" />
              {showFeed ? "Hide Activity Feed" : "Show Activity Feed"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/reports">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <Home className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>
          </>
        }
      />

      <SectionCard
        as="div"
        className="flex-row flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm"
      >
        <Chip icon={User}>{userName}</Chip>
        {facilityName ? <Chip icon={Building2}>{facilityName}</Chip> : null}
        <Chip icon={Calendar} muted>
          {now ? formatDate(now) : "—"}
        </Chip>
        <Chip icon={Clock} muted>
          <span className="tabular-nums">{now ? formatTime(now) : "—"}</span>
        </Chip>
        <Chip icon={Thermometer} muted>
          {tempLabel}
        </Chip>
      </SectionCard>

      {showFeed ? (
        <SectionCard as="div" className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No submissions yet.
            </p>
          ) : (
            <DataList>
              {recent.map((r) => (
                <DataListRow key={r.id} as="div">
                  <span className="flex flex-1 flex-wrap items-center gap-2">
                    <Badge variant="secondary">{r.label}</Badge>
                    <span className="text-muted-foreground">
                      {[r.rinkName, r.equipmentName]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                    {r.failedCount > 0 ? (
                      <Badge variant="warning">{r.failedCount} failed</Badge>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatWhen(r.when)}
                  </span>
                </DataListRow>
              ))}
            </DataList>
          )}
        </SectionCard>
      ) : null}
    </div>
  )
}

function Chip({
  icon: Icon,
  muted = false,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  muted?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={
        "flex items-center gap-2 " +
        (muted ? "text-muted-foreground" : "font-medium")
      }
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      {children}
    </span>
  )
}
