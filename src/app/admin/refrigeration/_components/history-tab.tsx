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
  ReportDetailData,
  ReportListItem,
} from "../types"

import { HistoryFilters } from "./history-filters"
import { ReportDetail } from "./report-detail"

type HistoryParams = {
  employee?: string
  from?: string
  to?: string
  oor?: string
  q?: string
}

type Props = {
  list: ReportListItem[]
  detail: ReportDetailData | null
  backHref: string
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

function buildDetailHref(reportId: string, params: HistoryParams): string {
  const sp = new URLSearchParams()
  sp.set("tab", "history")
  sp.set("report", reportId)
  for (const k of ["employee", "from", "to", "oor", "q"] as const) {
    const v = params[k]
    if (v) sp.set(k, v)
  }
  return `/admin/refrigeration?${sp.toString()}`
}

function hasAnyFilter(p: HistoryParams): boolean {
  return Boolean(p.employee || p.oor || p.q)
}

export function HistoryTab({
  list,
  detail,
  backHref,
  employees,
  params,
}: Props) {
  if (detail) {
    return <ReportDetail detail={detail} backHref={backHref} />
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilters employees={employees} params={params} />
      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasAnyFilter(params)
                ? "No reports match your filters"
                : "No reports submitted in selected window"}
            </CardTitle>
            <CardDescription>
              <Link
                href="/admin/refrigeration?tab=history"
                className="text-primary underline"
              >
                Reset filters
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ReportsList list={list} params={params} />
      )}
    </div>
  )
}

function ReportsList({
  list,
  params,
}: {
  list: ReportListItem[]
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
            <th className="border-b px-3 py-2 text-left font-medium">
              Submitter
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Values</th>
            <th className="border-b px-3 py-2 text-left font-medium">OOR</th>
            <th className="border-b px-3 py-2 text-left font-medium">Notes</th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle">
                {fmt(r.submitted_at)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.employee
                  ? `${r.employee.first_name} ${r.employee.last_name}`
                  : "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.value_count}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <span
                  className={cn(
                    "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
                    r.out_of_range_count > 0
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.out_of_range_count}
                </span>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.notes_excerpt ? (
                  <span className="text-muted-foreground line-clamp-1">
                    {r.notes_excerpt}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <div className="flex justify-end">
                  <Link
                    href={buildDetailHref(r.id, params)}
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
