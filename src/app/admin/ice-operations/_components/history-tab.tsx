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
  EquipmentRow,
  OperationType,
  RinkRow,
  SettingsRow,
  SubmissionDetailData,
  SubmissionListItem,
  TemperatureUnit,
} from "../types"
import {
  formatTemp,
  operationLabel,
  readEdgingPayload,
  readIceMakePayload,
  readPropaneTankChangePayload,
} from "../types"

import { HistoryFilters } from "./history-filters"
import { SubmissionDetail } from "./submission-detail"

type HistoryParams = {
  employee?: string
  rink?: string
  equipment?: string
  op?: OperationType[]
  failed?: string
  from?: string
  to?: string
  q?: string
}

type Props = {
  list: SubmissionListItem[]
  detail: SubmissionDetailData | null
  backHref: string
  employees: EmployeeLite[]
  rinks: RinkRow[]
  equipment: EquipmentRow[]
  settings: SettingsRow | null
  params: HistoryParams
  timeZone: string | null
}

// Facility-zoned, like every other timestamp in the app. This list used to
// format with no timeZone at all, so it disagreed with the detail view (which
// already renders through LocalDateTime) and misread as UTC on the server.
function fmt(ts: string, timeZone: string | null): string {
  return formatInTz(ts, timeZone)
}

function buildDetailHref(submissionId: string, params: HistoryParams): string {
  const sp = new URLSearchParams()
  sp.set("tab", "history")
  sp.set("submission", submissionId)
  if (params.employee) sp.set("employee", params.employee)
  if (params.rink) sp.set("rink", params.rink)
  if (params.equipment) sp.set("equipment", params.equipment)
  if (params.failed) sp.set("failed", params.failed)
  if (params.from) sp.set("from", params.from)
  if (params.to) sp.set("to", params.to)
  if (params.q) sp.set("q", params.q)
  for (const op of params.op ?? []) sp.append("op", op)
  return `/admin/ice-operations?${sp.toString()}`
}

function hasAnyFilter(p: HistoryParams): boolean {
  return Boolean(
    p.employee ||
      p.rink ||
      p.equipment ||
      (p.op && p.op.length > 0) ||
      p.failed ||
      p.q,
  )
}

export function HistoryTab({
  list,
  detail,
  backHref,
  employees,
  rinks,
  equipment,
  settings,
  params,
  timeZone,
}: Props) {
  const tempUnit: TemperatureUnit =
    (settings?.temperature_unit as TemperatureUnit) ?? "F"

  if (detail) {
    return (
      <SubmissionDetail
        detail={detail}
        backHref={backHref}
        tempUnit={tempUnit}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilters
        employees={employees}
        rinks={rinks}
        equipment={equipment}
        params={params}
      />
      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {hasAnyFilter(params)
                ? "No submissions match your filters"
                : "No submissions in selected window"}
            </CardTitle>
            <CardDescription>
              <Link
                href="/admin/ice-operations?tab=history"
                className="text-primary underline"
              >
                Reset filters
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <SubmissionsList
          list={list}
          params={params}
          tempUnit={tempUnit}
          timeZone={timeZone}
        />
      )}
    </div>
  )
}

function summarizeSubmission(
  s: SubmissionListItem,
  tempUnit: TemperatureUnit,
): string {
  switch (s.operation_type) {
    case "ice_make": {
      const p = readIceMakePayload(s.payload)
      const parts: string[] = []
      if (p.water_used_gal !== null) parts.push(`${p.water_used_gal} gal`)
      if (p.machine_hours !== null) parts.push(`${p.machine_hours} hrs`)
      if (p.snow_taken_pct !== null) parts.push(`${p.snow_taken_pct}% snow`)
      if (p.propane_tank_changed) parts.push("propane tank changed")
      if (parts.length === 0 && (p.water_temp_c !== null || p.ice_temp_c !== null)) {
        parts.push(
          `Water ${formatTemp(p.water_temp_c, tempUnit)} / Ice ${formatTemp(p.ice_temp_c, tempUnit)}`,
        )
      }
      return parts.length > 0 ? parts.join(" · ") : "Resurface"
    }
    case "circle_check": {
      const failed = s.failed_count
      // We don't have results count in the list payload — show fail count only.
      return failed > 0
        ? `${failed} failed check${failed === 1 ? "" : "s"}`
        : "All passed"
    }
    case "edging": {
      const p = readEdgingPayload(s.payload)
      return p.hours_run !== null ? `${p.hours_run} hrs run` : "Edging"
    }
    case "blade_change":
      return "Blade changed"
    case "propane_tank_change": {
      const p = readPropaneTankChangePayload(s.payload)
      return p.hours_at_change !== null
        ? `Tank changed at ${p.hours_at_change} hrs`
        : "Propane tank changed"
    }
    default:
      return operationLabel(s.operation_type)
  }
}

function SubmissionsList({
  list,
  params,
  tempUnit,
  timeZone,
}: {
  list: SubmissionListItem[]
  params: HistoryParams
  tempUnit: TemperatureUnit
  timeZone: string | null
}) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">
              Occurred
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Op</th>
            <th className="border-b px-3 py-2 text-left font-medium">Rink</th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Equipment
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Employee
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Summary
            </th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle whitespace-nowrap">
                {fmt(s.occurred_at, timeZone)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <Badge variant="secondary">
                  {operationLabel(s.operation_type)}
                </Badge>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.rink?.name ?? "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.equipment?.name ?? "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {s.employee
                  ? `${s.employee.first_name} ${s.employee.last_name}`
                  : "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground line-clamp-1">
                    {summarizeSubmission(s, tempUnit)}
                  </span>
                  {s.has_failed_check && (
                    <Badge variant="error">{s.failed_count} failed</Badge>
                  )}
                </div>
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
