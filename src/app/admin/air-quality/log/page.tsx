import Link from "next/link"

import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { AirQualityFormData } from "@/app/reports/air-quality/types"

import { PrintButton } from "./print-button"

export const dynamic = "force-dynamic"
export const metadata = { title: "Air Quality Log | MFO / Rink Reports" }

type SearchParams = Promise<{ from?: string; to?: string }>

type ReportRow = {
  id: string
  employee_id: string | null
  equipment_id: string | null
  submitted_at: string
  form_data: AirQualityFormData | null
}

type ReadingRow = {
  report_id: string
  key_snapshot: string
  label_snapshot: string
  value_numeric: number | string
  is_exceedance: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultTo(): string {
  return isoDate(new Date())
}

function defaultFrom(): string {
  return isoDate(new Date(Date.now() - 90 * DAY_MS))
}

function isCo(key: string, label: string): boolean {
  const k = key.toLowerCase()
  if (k.includes("co2")) return false
  if (k === "co" || k.startsWith("co_")) return true
  return /carbon monoxide/i.test(label)
}

function isNo2(key: string, label: string): boolean {
  const k = key.toLowerCase()
  if (k.includes("no2")) return true
  return /nitrogen dioxide|nitrogen/i.test(label)
}

function asNum(v: number | string): number | null {
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : null
}

export default async function AirQualityLogPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null
  const params = await searchParams

  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : defaultTo()
  const from =
    params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)
      ? params.from
      : defaultFrom()

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <h1 className="text-xl font-semibold">Air Quality Log</h1>
        <p className="text-muted-foreground text-sm">
          Create a facility before viewing the air quality log.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  // End-of-day bound so the `to` date is inclusive.
  const toBound = new Date(`${to}T00:00:00Z`)
  toBound.setUTCDate(toBound.getUTCDate() + 1)

  const [{ data: facility }, { data: reportsRaw }] = await Promise.all([
    supabase
      .from("facilities")
      .select("name, timezone")
      .eq("id", facilityId)
      .maybeSingle(),
    supabase
      .from("air_quality_reports")
      .select("id, employee_id, equipment_id, submitted_at, form_data")
      .eq("facility_id", facilityId)
      .gte("submitted_at", `${from}T00:00:00Z`)
      .lt("submitted_at", toBound.toISOString())
      .order("submitted_at", { ascending: true }),
  ])

  const reports = (reportsRaw ?? []) as ReportRow[]
  const reportIds = reports.map((r) => r.id)
  const employeeIds = Array.from(
    new Set(reports.map((r) => r.employee_id).filter((v): v is string => Boolean(v))),
  )
  const equipmentIds = Array.from(
    new Set(reports.map((r) => r.equipment_id).filter((v): v is string => Boolean(v))),
  )

  const [empRes, eqRes, readRes] = await Promise.all([
    employeeIds.length
      ? supabase
          .from("employees")
          .select("id, first_name, last_name")
          .in("id", employeeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null }> }),
    equipmentIds.length
      ? supabase.from("air_quality_equipment").select("id, name").in("id", equipmentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    reportIds.length
      ? supabase
          .from("air_quality_readings")
          .select("report_id, key_snapshot, label_snapshot, value_numeric, is_exceedance")
          .in("report_id", reportIds)
      : Promise.resolve({ data: [] as ReadingRow[] }),
  ])

  const empName = new Map(
    ((empRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).map(
      (e) => [e.id, [e.first_name, e.last_name].filter(Boolean).join(" ").trim()],
    ),
  )
  const eqName = new Map(
    ((eqRes.data ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
  )

  const coByReport = new Map<string, ReadingRow>()
  const no2ByReport = new Map<string, ReadingRow>()
  for (const r of (readRes.data ?? []) as ReadingRow[]) {
    if (isCo(r.key_snapshot, r.label_snapshot) && !coByReport.has(r.report_id)) {
      coByReport.set(r.report_id, r)
    } else if (isNo2(r.key_snapshot, r.label_snapshot) && !no2ByReport.has(r.report_id)) {
      no2ByReport.set(r.report_id, r)
    }
  }

  const tz = facility?.timezone || "UTC"
  const dateFmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "short", day: "2-digit" }).format(new Date(iso))
    } catch {
      return iso.slice(0, 10)
    }
  }
  const timeFmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    } catch {
      return iso.slice(11, 16)
    }
  }

  function resurfaceCount(fd: AirQualityFormData | null): string {
    const list = fd?.section1?.resurfacers ?? []
    const n = list.filter((r) => r.make_model || r.fuel_type).length
    return n > 0 ? String(n) : "—"
  }

  function deviceMaint(fd: AirQualityFormData | null): string {
    if (!fd) return "—"
    const parts: string[] = []
    if (fd.equipment?.co_monitor?.calibration_date) parts.push(`CO cal ${fd.equipment.co_monitor.calibration_date}`)
    if (fd.equipment?.no2_monitor?.calibration_date) parts.push(`NO2 cal ${fd.equipment.no2_monitor.calibration_date}`)
    if (fd.equipment?.ventilation_last_inspection) parts.push(`Vent ${fd.equipment.ventilation_last_inspection}`)
    if (parts.length === 0 && fd.section1?.maintenance?.resurfacers) parts.push(fd.section1.maintenance.resurfacers)
    return parts.length > 0 ? parts.join("; ") : "—"
  }

  function readingCell(r: ReadingRow | undefined): { text: string; exceeded: boolean } {
    if (!r) return { text: "—", exceeded: false }
    const n = asNum(r.value_numeric)
    return { text: n == null ? "—" : String(n), exceeded: r.is_exceedance }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <style>{`@media print { .no-print { display: none !important; } @page { size: landscape; margin: 12mm; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/air-quality?tab=history">← Back to history</Link>
        </Button>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="flex flex-col text-xs font-medium">
            From
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs font-medium">
            To
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-sm"
            />
          </label>
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
          <PrintButton />
        </form>
      </div>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Air Quality Monitoring Log
        </h1>
        <p className="text-muted-foreground text-sm">
          {facility?.name ?? "Facility"} · {dateFmt(`${from}T12:00:00Z`)} –{" "}
          {dateFmt(`${to}T12:00:00Z`)} · CO and NO₂ in ppm
        </p>
      </header>

      {reports.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No air quality reports were submitted in this date range.
        </p>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr>
                {[
                  "Date",
                  "Equipment",
                  "Time",
                  "# Resurfacers",
                  "CO (ppm)",
                  "NO₂ (ppm)",
                  "Device maintenance",
                  "Recorded by",
                ].map((h) => (
                  <th key={h} className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const co = readingCell(coByReport.get(r.id))
                const no2 = readingCell(no2ByReport.get(r.id))
                return (
                  <tr key={r.id} className="even:bg-muted/20">
                    <td className="border-b px-3 py-2 whitespace-nowrap">{dateFmt(r.submitted_at)}</td>
                    <td className="border-b px-3 py-2">
                      {r.equipment_id ? (eqName.get(r.equipment_id) ?? "—") : "—"}
                    </td>
                    <td className="border-b px-3 py-2 whitespace-nowrap">{timeFmt(r.submitted_at)}</td>
                    <td className="border-b px-3 py-2 text-center">{resurfaceCount(r.form_data)}</td>
                    <td className={`border-b px-3 py-2 text-right tabular-nums ${co.exceeded ? "font-semibold text-destructive" : ""}`}>
                      {co.text}
                    </td>
                    <td className={`border-b px-3 py-2 text-right tabular-nums ${no2.exceeded ? "font-semibold text-destructive" : ""}`}>
                      {no2.text}
                    </td>
                    <td className="border-b px-3 py-2">{deviceMaint(r.form_data)}</td>
                    <td className="border-b px-3 py-2 whitespace-nowrap">
                      {r.employee_id ? (empName.get(r.employee_id) || "—") : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Bold red values exceeded the configured evacuation threshold at submit
        time. This log reflects the readings as recorded; reports are immutable.
      </p>
    </div>
  )
}
