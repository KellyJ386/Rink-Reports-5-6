"use client"

import Link from "next/link"
import { Activity, ArrowLeft, Home, Settings } from "lucide-react"
import { useState } from "react"

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
  isAdmin: boolean
  configureHref: string
  recent: RecentActivityItem[]
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
  isAdmin,
  configureHref,
  recent,
}: Props) {
  const [showFeed, setShowFeed] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        variant="display"
        module="ice-ops"
        band
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
