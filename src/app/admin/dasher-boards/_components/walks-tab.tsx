import Link from "next/link"

import { LoadMoreLink } from "@/components/admin/load-more-link"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { formatInTz } from "@/lib/timezone"

import type { WalkDetailData, WalkListItem } from "../types"

import { WalkDetail } from "./walk-detail"

type Props = {
  list: WalkListItem[]
  detail: WalkDetailData | null
  backHref: string
  rinkId: string
  /** Facility IANA timezone; timestamps render as facility wall-clock. */
  timezone: string | null
  /** Set when more walks exist beyond the current window. */
  moreHref?: string | null
}

function buildDetailHref(rinkId: string, walkId: string): string {
  const sp = new URLSearchParams()
  sp.set("tab", "walks")
  sp.set("rink", rinkId)
  sp.set("walk", walkId)
  return `/admin/dasher-boards?${sp.toString()}`
}

export function WalksTab({
  list,
  detail,
  backHref,
  rinkId,
  timezone,
  moreHref,
}: Props) {
  if (detail) {
    return (
      <WalkDetail detail={detail} backHref={backHref} timezone={timezone} />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No walks yet</CardTitle>
            <CardDescription>
              Completed and in-progress inspection walks for this rink will
              show up here once staff start using the walk flow.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <WalksList list={list} rinkId={rinkId} timezone={timezone} />
          {moreHref ? (
            <LoadMoreLink href={moreHref} shown={list.length} />
          ) : null}
        </>
      )}
    </div>
  )
}

function WalksList({
  list,
  rinkId,
  timezone,
}: {
  list: WalkListItem[]
  rinkId: string
  timezone: string | null
}) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">
              Started
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Completed
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Inspector
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Status
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Fails
            </th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((w) => (
            <tr key={w.id} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle">
                {formatInTz(w.started_at, timezone)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {w.completed_at ? formatInTz(w.completed_at, timezone) : "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {w.inspector
                  ? `${w.inspector.first_name} ${w.inspector.last_name}`
                  : "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {w.completed_at ? (
                  <Badge variant="secondary">Completed</Badge>
                ) : (
                  <Badge variant="warning">In progress</Badge>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <Badge variant={w.failCount > 0 ? "error" : "secondary"}>
                  {w.failCount}
                </Badge>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <div className="flex justify-end">
                  <Link
                    href={buildDetailHref(rinkId, w.id)}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    View
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
