import { redirect } from "next/navigation"
import { Fence } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { RinkPerimeter } from "@/components/rink/rink-perimeter"
import type { PerimeterCondition } from "@/components/rink/rink-perimeter"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { formatInTz } from "@/lib/timezone"

import { getInspectionStatus, getRinkPerimeter } from "./_lib/queries"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dasher Boards | Rink Reports" }

export default async function DasherBoardsPage() {
  await requireUser()
  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "dasher_boards", "view"))) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <EmptyState
          icon={<Fence className="text-muted-foreground size-8" />}
          title="No access to Dasher Boards"
          description="Ask an administrator to grant you the Dasher Boards view permission."
        />
      </div>
    )
  }

  const { data: rinks } = await supabase
    .from("dasher_boards_rinks")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  // Empty-module state: admins go straight into the setup wizard; staff see a
  // not-yet-configured notice.
  if (!rinks || rinks.length === 0) {
    if (await currentUserCan(supabase, "dasher_boards", "admin")) {
      redirect("/admin/dasher-boards")
    }
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <EmptyState
          icon={<Fence className="text-muted-foreground size-8" />}
          title="Dasher Boards isn't set up yet"
          description="A facility manager needs to configure the rink perimeter before inspections can start."
        />
      </div>
    )
  }

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .limit(1)
    .maybeSingle()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        title="Dasher Boards"
        eyebrow="Perimeter condition"
        description="The live condition map of every board, glass panel, and door. Inspection walks arrive with the next update — issues persist on each asset until resolved."
      />
      {rinks.map(async (rink) => {
        const [perimeter, status] = await Promise.all([
          getRinkPerimeter(supabase, rink.id),
          getInspectionStatus(supabase, rink.id),
        ])
        if (!perimeter) return null

        const positioned = perimeter.assets.filter(
          (a) =>
            (a.asset_type === "board_panel" || a.asset_type === "door") &&
            a.is_active &&
            a.sequence_position !== null,
        )
        const conditionByAssetId: Record<string, PerimeterCondition> = {}
        for (const a of perimeter.assets) {
          if (a.worst_open_severity === "a") conditionByAssetId[a.id] = "alert"
          else if (a.worst_open_severity) conditionByAssetId[a.id] = "warn"
        }

        return (
          <Card key={rink.id} className="gap-4 py-5">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{rink.name}</CardTitle>
                <div className="flex flex-wrap gap-1.5">
                  {status && status.openCounts.a > 0 && (
                    <Badge variant="destructive">{status.openCounts.a} A</Badge>
                  )}
                  {status && status.openCounts.b > 0 && (
                    <Badge variant="warning">{status.openCounts.b} B</Badge>
                  )}
                  {status && status.openCounts.c > 0 && (
                    <Badge variant="warning">{status.openCounts.c} C</Badge>
                  )}
                  {status &&
                    status.openCounts.a + status.openCounts.b + status.openCounts.c ===
                      0 && <Badge variant="success">All clear</Badge>}
                </div>
              </div>
              <CardDescription>
                {status?.lastCompletedAt
                  ? `Last walked ${formatInTz(status.lastCompletedAt, facility?.timezone ?? null)}${
                      status.lastInspectorName
                        ? ` by ${status.lastInspectorName}`
                        : ""
                    }.`
                  : "No completed walks yet."}
                {status && !status.walkedToday && " Due today."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {positioned.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Perimeter not generated yet.
                </p>
              ) : (
                <RinkPerimeter
                  className="mx-auto w-full max-w-sm"
                  positioned={positioned.map((a) => ({
                    id: a.id,
                    label: a.label,
                    asset_type: a.asset_type as "board_panel" | "door",
                  }))}
                  direction={
                    rink.perimeter_direction as "clockwise" | "counterclockwise"
                  }
                  conditionByAssetId={conditionByAssetId}
                />
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
