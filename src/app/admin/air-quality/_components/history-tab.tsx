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
  EquipmentRow,
  LocationRow,
  ReadingTypeRow,
  ReportDetailData,
  ReportListItem,
  Severity,
} from "../types"

import { HistoryFilters } from "./history-filters"
import { ReportDetail } from "./report-detail"

type HistoryParams = {
  employee?: string
  location?: string
  equipment?: string
  reading_type?: string
  exceedance?: string
  from?: string
  to?: string
  q?: string
}

type Props = {
  list: ReportListItem[]
  detail: ReportDetailData | null
  backHref: string
  employees: EmployeeLite[]
  locations: LocationRow[]
  equipment: EquipmentRow[]
  readingTypes: ReadingTypeRow[]
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
    "employee",
    "location",
    "equipment",
    "reading_type",
    "exceedance",
    "from",
    "to",
    "q",
  ] as const) {
    const v = params[k]
    if (v) sp.set(k, v)
  }
  return `/admin/air-quality?${sp.toString()}`
}

function hasAnyFilter(p: HistoryParams): boolean {
  return Boolean(
    p.employee ||
      p.location ||
      p.equipment ||
      p.reading_type ||
      p.exceedance ||
      p.q,
  )
}

function severityBadgeClass(sev: Severity): string {
  if (sev === "critical")
    return "bg-destructive/15 text-destructive"
  if (sev === "high")
    return "bg-orange-500/15 text-orange-700 dark:text-orange-300"
  return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
}

export function HistoryTab({
  list,
  detail,
  backHref,
  employees,
  locations,
  equipment,
  readingTypes,
  params,
}: Props) {
  if (detail) {
    return <ReportDetail detail={detail} backHref={backHref} />
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilters
        employees={employees}
        locations={locations}
        equipment={equipment}
        readingTypes={readingTypes}
        params={params}
      />
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
                href="/admin/air-quality?tab=history"
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
              Location
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Equipment
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Submitter
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Readings
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Exceedance
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Notes</th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const sev = (r.max_severity as Severity | null) ?? null
            return (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="border-b px-3 py-2 align-middle">
                  {fmt(r.submitted_at)}
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  {r.location?.name ?? "—"}
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  {r.equipment?.name ?? "—"}
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  {r.employee
                    ? `${r.employee.first_name} ${r.employee.last_name}`
                    : "—"}
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  {r.reading_count}
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  {r.has_exceedance ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        sev
                          ? severityBadgeClass(sev)
                          : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {r.exceedance_count}
                      {sev ? ` · ${sev}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">OK</span>
                  )}
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
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
