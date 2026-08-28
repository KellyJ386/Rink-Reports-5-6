import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { formatInTz } from "@/lib/timezone"
import { formatAssetLabel } from "@/app/reports/dasher-boards/_lib/glass-numbering"

import type { WalkDetailData } from "../types"

const TYPE_LABELS: Record<string, string> = {
  board_panel: "Board panel",
  glass_panel: "Glass panel",
  door: "Door",
}

type Props = {
  detail: WalkDetailData
  backHref: string
  /** Facility IANA timezone; timestamps render as facility wall-clock. */
  timezone: string | null
}

export function WalkDetail({ detail, backHref, timezone }: Props) {
  const { inspection, inspector, checks, glassNumbers } = detail
  const failCount = checks.filter((c) => c.status === "fail").length
  const completed = inspection.completed_at !== null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>← Back to walks</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>
                Walk — {formatInTz(inspection.started_at, timezone)}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                Inspector{" "}
                {inspector
                  ? `${inspector.first_name} ${inspector.last_name}`
                  : "Unknown"}
                {completed
                  ? ` · Completed ${formatInTz(inspection.completed_at as string, timezone)}`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {completed ? (
                  <Badge variant="secondary">Completed</Badge>
                ) : (
                  <Badge variant="warning">In progress</Badge>
                )}
                <Badge variant={failCount > 0 ? "error" : "success"}>
                  {failCount} fail{failCount === 1 ? "" : "s"}
                </Badge>
                {inspection.inspection_kind === "annual_contractor" && (
                  <Badge variant="special">Annual contractor</Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {inspection.inspection_kind === "annual_contractor" && (
            <section className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3">
              <h3 className="text-sm font-semibold">Annual contractor inspection</h3>
              <p className="text-sm">
                {inspection.contractor_name ?? "Unknown contractor"}
                {inspection.contractor_company
                  ? ` · ${inspection.contractor_company}`
                  : ""}
              </p>
            </section>
          )}

          {!completed && (
            <p className="text-muted-foreground text-xs">
              This walk is still open — its asset checks can still change
              until the inspector signs off.
            </p>
          )}

          {inspection.notes && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Walk notes</h3>
              <p className="bg-muted/30 rounded-md border p-3 text-sm whitespace-pre-wrap">
                {inspection.notes}
              </p>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              Asset checks ({checks.length})
            </h3>
            {checks.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No assets checked yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {checks.map((c) => (
                  <li
                    key={c.id}
                    className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {c.asset
                            ? formatAssetLabel(c.asset, glassNumbers)
                            : "Unknown asset"}
                        </span>
                        {c.asset && (
                          <Badge variant="outline">
                            {TYPE_LABELS[c.asset.asset_type] ??
                              c.asset.asset_type}
                          </Badge>
                        )}
                        <Badge variant={c.status === "fail" ? "error" : "success"}>
                          {c.status === "fail" ? "Fail" : "Pass"}
                        </Badge>
                      </div>
                      {c.checkedBy && (
                        <span className="text-muted-foreground text-xs">
                          Checked by {c.checkedBy.first_name}{" "}
                          {c.checkedBy.last_name}
                        </span>
                      )}
                    </div>
                    {c.note && (
                      <p className="text-sm whitespace-pre-wrap">{c.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  )
}
