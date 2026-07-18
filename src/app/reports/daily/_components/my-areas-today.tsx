"use client"

// Staff landing view for Daily Reports when assignment routing is ON (D7):
// "My Areas Today" cards + a collapsed "Open areas" section (D4), each card
// opening the existing DailyReportConsole scoped to that single area. With
// routing OFF this component is never rendered — page.tsx falls back to the
// pre-feature console, unchanged.

import { useState, useTransition } from "react"
import { ArrowLeft, Bell, CheckCircle2, ChevronDown, Circle } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import {
  markAssignmentNotificationsReadAction,
  type AssignmentNotification,
  type MyAreasToday,
} from "../assignment-actions"
import {
  DailyReportConsole,
  type ConsoleArea,
} from "./daily-report-console"

type AreaStatus = MyAreasToday["myAreas"][number]

type Props = {
  data: MyAreasToday
  /** Full console data (templates + items) for every area in the landing. */
  consoleAreas: ConsoleArea[]
  notifications: AssignmentNotification[]
  unreadCount: number
}

function formatCardDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`))
  } catch {
    return iso
  }
}

function AreaCard({
  area,
  onOpen,
}: {
  area: AreaStatus
  onOpen: (id: string) => void
}) {
  const accent = area.color?.trim() || null
  const progress =
    area.templatesTotal > 1
      ? `${area.templatesDone}/${area.templatesTotal} shifts`
      : null
  return (
    <button
      type="button"
      onClick={() => onOpen(area.id)}
      className="group text-left outline-none"
    >
      <Card
        className="h-full gap-3 border-l-4 py-4 transition-shadow group-hover:shadow-[var(--shadow-elev-2)] group-focus-visible:ring-[3px] group-focus-visible:ring-[var(--accent-brand)]/55"
        style={{ borderLeftColor: accent ?? "var(--module-daily)" }}
      >
        <div className="flex items-start justify-between gap-3 px-5">
          <span className="text-base font-semibold leading-tight">
            {area.name}
          </span>
          {area.done ? (
            <Badge className="shrink-0 gap-1 bg-primary/15 text-primary hover:bg-primary/15">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Done
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 text-muted-foreground"
            >
              <Circle className="h-3 w-3" aria-hidden />
              Not started
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 text-sm text-muted-foreground">
          <span>
            {progress ??
              (area.done ? "Report submitted" : "Tap to start the checklist")}
          </span>
          {area.assignees.length > 1 ? (
            <span className="truncate text-xs">
              With{" "}
              {area.assignees
                .filter((a) => a.name)
                .map((a) => a.name.split(" ")[0])
                .slice(0, 3)
                .join(", ")}
            </span>
          ) : null}
        </div>
      </Card>
    </button>
  )
}

export function MyAreasTodayView({
  data,
  consoleAreas,
  notifications,
  unreadCount,
}: Props) {
  const [openAreaId, setOpenAreaId] = useState<string | null>(null)
  const [showOpenAreas, setShowOpenAreas] = useState(data.myAreas.length === 0)
  const [dismissedBanner, setDismissedBanner] = useState(false)
  const [pending, startTransition] = useTransition()

  const selectedConsoleArea = openAreaId
    ? consoleAreas.find((a) => a.id === openAreaId)
    : null

  if (selectedConsoleArea) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpenAreaId(null)}
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            All my areas
          </Button>
        </div>
        <DailyReportConsole areas={[selectedConsoleArea]} />
      </div>
    )
  }

  const unread = notifications.filter((n) => !n.readAt)

  function markAllRead() {
    startTransition(async () => {
      const result = await markAssignmentNotificationsReadAction("all")
      if (!result.ok) toast.error(result.error)
      setDismissedBanner(true)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Assignment notifications (D6) — compact banner, mark-all to clear. */}
      {!dismissedBanner && unreadCount > 0 && unread.length > 0 ? (
        <Card className="gap-3 border-l-4 border-l-module-daily py-4">
          <div className="flex items-start justify-between gap-3 px-5">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                <Bell className="h-4 w-4" />
              </span>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">
                  Assignment update{unreadCount === 1 ? "" : "s"}
                </span>
                <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                  {unread.slice(0, 3).map((n) => (
                    <li key={n.id}>
                      {n.type === "assigned" ? "Assigned to" : "Removed from"}{" "}
                      <span className="font-medium text-foreground">
                        {n.areaName ?? "an area"}
                      </span>{" "}
                      for {formatCardDate(n.reportDate)}
                    </li>
                  ))}
                  {unreadCount > 3 ? (
                    <li>…and {unreadCount - 3} more</li>
                  ) : null}
                </ul>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={markAllRead}
              disabled={pending}
            >
              Mark read
            </Button>
          </div>
        </Card>
      ) : null}

      {/* My areas */}
      <section className="flex flex-col gap-3" aria-label="My areas today">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            My areas today
          </h2>
          <span className="text-sm tabular-nums text-muted-foreground">
            {data.myAreas.filter((a) => a.done).length}/{data.myAreas.length}{" "}
            complete
          </span>
        </div>
        {data.myAreas.length === 0 ? (
          <Card className="py-6">
            <p className="px-6 text-sm text-muted-foreground">
              No areas assigned to you today — open areas below are available to
              everyone.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.myAreas.map((area) => (
              <AreaCard key={area.id} area={area} onOpen={setOpenAreaId} />
            ))}
          </div>
        )}
      </section>

      {/* Open areas (D4) — collapsed by default when the user has assignments */}
      <section className="flex flex-col gap-3" aria-label="Open areas">
        <button
          type="button"
          onClick={() => setShowOpenAreas((v) => !v)}
          aria-expanded={showOpenAreas}
          className="flex items-center gap-2 text-left text-lg font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-brand)]/55"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "h-5 w-5 text-muted-foreground transition-transform",
              !showOpenAreas && "-rotate-90",
            )}
          />
          Open areas
          <span className="text-sm font-normal tabular-nums text-muted-foreground">
            {data.openAreas.length}
          </span>
        </button>
        {showOpenAreas ? (
          data.openAreas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every area is assigned today.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.openAreas.map((area) => (
                <AreaCard key={area.id} area={area} onOpen={setOpenAreaId} />
              ))}
            </div>
          )
        ) : null}
      </section>
    </div>
  )
}
