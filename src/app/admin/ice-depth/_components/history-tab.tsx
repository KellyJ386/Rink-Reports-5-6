import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { formatInTz } from "@/lib/timezone"

import type {
  EmployeeLite,
  HistoryParams,
  LayoutRow,
  SessionDetailData,
  SessionListItem,
} from "../types"

import { HistoryFilters } from "./history-filters"
import { SessionDetail } from "./session-detail"

type Props = {
  list: SessionListItem[]
  detail: SessionDetailData | null
  backHref: string
  layouts: LayoutRow[]
  employees: EmployeeLite[]
  params: HistoryParams
  /** "Load more" target preserving filters, or null when all rows are shown. */
  moreHref: string | null
  /** Super admins may hard-delete an (otherwise immutable) session. */
  canDelete: boolean
  /** Facility IANA timezone; timestamps render as facility wall-clock. */
  timezone: string | null
}

function buildDetailHref(sessionId: string, params: HistoryParams): string {
  const sp = new URLSearchParams()
  sp.set("tab", "history")
  sp.set("session", sessionId)
  for (const k of ["layout", "employee", "has_low", "has_high", "from", "to"] as const) {
    const v = params[k]
    if (v) sp.set(k, v)
  }
  return `/admin/ice-depth?${sp.toString()}`
}

function hasAnyFilter(p: HistoryParams): boolean {
  return Boolean(p.layout || p.employee || p.has_low || p.has_high)
}

export function HistoryTab({
  list,
  detail,
  backHref,
  layouts,
  employees,
  params,
  moreHref,
  canDelete,
  timezone,
}: Props) {
  if (detail) {
    return (
      <SessionDetail
        detail={detail}
        backHref={backHref}
        canDelete={canDelete}
        timezone={timezone}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilters layouts={layouts} employees={employees} params={params} />
      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasAnyFilter(params)
                ? "No sessions match your filters"
                : "No sessions in selected window"}
            </CardTitle>
            <CardDescription>
              <Link
                href="/admin/ice-depth?tab=history"
                className="text-primary underline"
              >
                Reset filters
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <SessionsList list={list} params={params} timezone={timezone} />
          {moreHref && (
            <div className="flex justify-center">
              <Link
                href={moreHref}
                scroll={false}
                className="text-primary text-sm font-medium hover:underline"
              >
                Load more
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SessionsList({
  list,
  params,
  timezone,
}: {
  list: SessionListItem[]
  params: HistoryParams
  timezone: string | null
}) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">
              Submitted
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Layout</th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Employee
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Total</th>
            <th className="border-b px-3 py-2 text-left font-medium">Low</th>
            <th className="border-b px-3 py-2 text-left font-medium">High</th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle">
                {formatInTz(s.submitted_at, timezone)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.layout?.name ?? "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.employee
                  ? `${s.employee.first_name} ${s.employee.last_name}`
                  : "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.total_measurements}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <Badge variant={s.low_count > 0 ? "error" : "secondary"}>
                  {s.low_count}
                </Badge>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <Badge variant={s.high_count > 0 ? "warning" : "secondary"}>
                  {s.high_count}
                </Badge>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <div className="flex justify-end">
                  <Link
                    href={buildDetailHref(s.id, params)}
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
