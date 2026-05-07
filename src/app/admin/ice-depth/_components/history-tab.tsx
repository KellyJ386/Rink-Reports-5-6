import Link from "next/link"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

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
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
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
}: Props) {
  if (detail) {
    return <SessionDetail detail={detail} backHref={backHref} />
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
        <SessionsList list={list} params={params} />
      )}
    </div>
  )
}

function SessionsList({
  list,
  params,
}: {
  list: SessionListItem[]
  params: HistoryParams
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
                {fmt(s.submitted_at)}
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
                <span
                  className={cn(
                    "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
                    s.low_count > 0
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.low_count}
                </span>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <span
                  className={cn(
                    "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
                    s.high_count > 0
                      ? "bg-yellow-500/20 text-yellow-800 dark:text-yellow-200"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.high_count}
                </span>
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
