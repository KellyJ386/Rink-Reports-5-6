import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type {
  EmployeeLite,
  IncidentReportDetail,
  IncidentReportListItem,
  IncidentTypeRow,
  SeverityRow,
} from "../types"

import { HistoryFilters } from "./history-filters"
import { ReportDetail } from "./report-detail"
import { StatusBadge } from "./status-badge"

type HistoryParams = {
  status?: string
  type?: string
  severity?: string
  employee?: string
  location?: string
  from?: string
  to?: string
}

type Props = {
  list: IncidentReportListItem[]
  detail: IncidentReportDetail | null
  backHref: string
  types: Array<Pick<IncidentTypeRow, "id" | "name" | "color" | "slug">>
  severities: Array<Pick<SeverityRow, "id" | "key" | "display_name" | "color">>
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
  for (const k of [
    "status",
    "type",
    "severity",
    "employee",
    "location",
    "from",
    "to",
  ] as const) {
    const v = params[k]
    if (v) sp.set(k, v)
  }
  return `/admin/incident-reports?${sp.toString()}`
}

function hasAnyFilter(p: HistoryParams): boolean {
  return Boolean(
    p.status ||
      p.type ||
      p.severity ||
      p.employee ||
      p.location ||
      p.from ||
      p.to,
  )
}

export function HistoryTab({
  list,
  detail,
  backHref,
  types,
  severities,
  employees,
  params,
}: Props) {
  if (detail) {
    return <ReportDetail detail={detail} backHref={backHref} />
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilters
        types={types}
        severities={severities}
        employees={employees}
        params={params}
      />
      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasAnyFilter(params)
                ? "No reports match your filters"
                : "No incident reports submitted"}
            </CardTitle>
            <CardDescription>
              {hasAnyFilter(params)
                ? "Try widening the date range or clearing a filter."
                : "When staff submit reports, they'll appear here."}
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
  list: IncidentReportListItem[]
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
              Reporter
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Type</th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Severity
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Location
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Status
            </th>
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
                {r.reporter_name}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.type ? (
                  <Badge variant="secondary" className="gap-1.5">
                    {r.type.color && (
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: r.type.color }}
                      />
                    )}
                    {r.type.name}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.severity ? (
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    style={
                      r.severity.color
                        ? {
                            backgroundColor: `${r.severity.color}22`,
                            color: r.severity.color,
                          }
                        : undefined
                    }
                  >
                    {r.severity.display_name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {r.locationLabel || (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <StatusBadge status={r.status} />
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
