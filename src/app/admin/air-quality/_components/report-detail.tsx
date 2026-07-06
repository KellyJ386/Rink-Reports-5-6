"use client"

import Link from "next/link"
import { useActionState, useEffect } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  ARENA_STATUS_OPTIONS,
  ELECTRIC_EQUIPMENT_OPTIONS,
  FUEL_TYPE_OPTIONS,
  VENTILATION_STATUS_OPTIONS,
  type AirQualityFormData,
  type AirQualityMeasurement,
} from "@/app/reports/air-quality/types"

import { formatInTz } from "@/lib/timezone"

import { addAirQualityFollowupNote } from "../actions"
import type {
  ActionState,
  ReadingRow,
  ReportDetailData,
  Severity,
} from "../types"

const NOTE_INITIAL: ActionState = { ok: null }

type Props = {
  detail: ReportDetailData
  backHref: string
  /** Facility IANA timezone; timestamps render as facility wall-clock. */
  timezone: string | null
}

function severityBadgeVariant(sev: Severity | null): "destructive" | "warning" {
  if (sev === "critical") return "destructive"
  return "warning"
}

function labelFor(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null,
): string | null {
  if (!value) return null
  return options.find((o) => o.value === value)?.label ?? value
}

function asFormData(value: unknown): AirQualityFormData | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AirQualityFormData)
    : null
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function MeasurementsTable({ rows }: { rows: AirQualityMeasurement[] }) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">Location</th>
            <th className="border-b px-3 py-2 text-left font-medium">Time</th>
            <th className="border-b px-3 py-2 text-left font-medium">CO</th>
            <th className="border-b px-3 py-2 text-left font-medium">NO2</th>
            <th className="border-b px-3 py-2 text-left font-medium">Temp</th>
            <th className="border-b px-3 py-2 text-left font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-top">{r.location ?? "—"}</td>
              <td className="border-b px-3 py-2 align-top">{r.time ?? "—"}</td>
              <td className="border-b px-3 py-2 align-top">{r.co ?? "—"}</td>
              <td className="border-b px-3 py-2 align-top">{r.no2 ?? "—"}</td>
              <td className="border-b px-3 py-2 align-top">
                {r.temperature ?? "—"}
              </td>
              <td className="border-b px-3 py-2 align-top">{r.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MonitoringLogDetails({ data }: { data: AirQualityFormData }) {
  const eq = data.equipment
  const s1 = data.section1
  const s2 = data.section2
  const s4 = data.section4

  const equipmentRows: Array<{ label: string; value: string }> = []
  if (data.date_of_test)
    equipmentRows.push({ label: "Date of test", value: data.date_of_test })
  if (data.tester_certification)
    equipmentRows.push({
      label: "Tester certification",
      value: data.tester_certification,
    })
  const coParts = [eq.co_monitor.type, eq.co_monitor.model]
    .filter(Boolean)
    .join(" · ")
  if (coParts || eq.co_monitor.calibration_date)
    equipmentRows.push({
      label: "CO monitor",
      value: [coParts, eq.co_monitor.calibration_date && `cal ${eq.co_monitor.calibration_date}`]
        .filter(Boolean)
        .join(" — "),
    })
  const no2Parts = [eq.no2_monitor.type, eq.no2_monitor.model]
    .filter(Boolean)
    .join(" · ")
  if (no2Parts || eq.no2_monitor.calibration_date)
    equipmentRows.push({
      label: "NO2 monitor",
      value: [no2Parts, eq.no2_monitor.calibration_date && `cal ${eq.no2_monitor.calibration_date}`]
        .filter(Boolean)
        .join(" — "),
    })
  if (eq.ventilation_last_inspection)
    equipmentRows.push({
      label: "Ventilation last inspection",
      value: eq.ventilation_last_inspection,
    })

  const arenaStatus = labelFor(ARENA_STATUS_OPTIONS, s1.arena_status)
  const ventStatus = labelFor(VENTILATION_STATUS_OPTIONS, s1.ventilation_status)
  const resurfacers = s1.resurfacers.filter(
    (r) => r.make_model || r.fuel_type,
  )
  const otherEquipment = s1.other_equipment.filter((r) => r.name || r.fuel_type)
  const hasSection1 =
    arenaStatus ||
    ventStatus ||
    resurfacers.length > 0 ||
    otherEquipment.length > 0 ||
    s1.maintenance.resurfacers ||
    s1.maintenance.ventilation ||
    s1.maintenance.other

  const electric = labelFor(
    ELECTRIC_EQUIPMENT_OPTIONS,
    s4.electric_equipment_consideration,
  )
  const hasSection4 =
    electric || s4.staff_trained || s4.public_signage || s4.unusual_observations

  const hasAny =
    equipmentRows.length > 0 ||
    hasSection1 ||
    s2.routine.length > 0 ||
    s2.post_edging.length > 0 ||
    hasSection4

  if (!hasAny) return null

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Monitoring log</h3>

      {equipmentRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-muted-foreground text-xs font-semibold uppercase">
            Equipment & tester
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {equipmentRows.map((r) => (
              <DetailRow key={r.label} label={r.label} value={r.value} />
            ))}
          </div>
        </div>
      )}

      {hasSection1 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-muted-foreground text-xs font-semibold uppercase">
            Section 1 · General info
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {arenaStatus && (
              <DetailRow label="Arena status" value={arenaStatus} />
            )}
            {ventStatus && (
              <DetailRow label="Ventilation status" value={ventStatus} />
            )}
            {s1.maintenance.resurfacers && (
              <DetailRow
                label="Last maintenance · resurfacers"
                value={s1.maintenance.resurfacers}
              />
            )}
            {s1.maintenance.ventilation && (
              <DetailRow
                label="Last maintenance · ventilation"
                value={s1.maintenance.ventilation}
              />
            )}
            {s1.maintenance.other && (
              <DetailRow
                label="Last maintenance · other"
                value={s1.maintenance.other}
              />
            )}
          </div>
          {resurfacers.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                Ice resurfacers
              </span>
              <ul className="list-disc pl-5 text-sm">
                {resurfacers.map((r, i) => (
                  <li key={i}>
                    {[
                      r.make_model,
                      labelFor(FUEL_TYPE_OPTIONS, r.fuel_type),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {otherEquipment.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                Other fuel-burning equipment
              </span>
              <ul className="list-disc pl-5 text-sm">
                {otherEquipment.map((r, i) => (
                  <li key={i}>
                    {[r.name, labelFor(FUEL_TYPE_OPTIONS, r.fuel_type)]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {s2.routine.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-muted-foreground text-xs font-semibold uppercase">
            Section 2 · Routine measurements
          </h4>
          <MeasurementsTable rows={s2.routine} />
        </div>
      )}

      {s2.post_edging.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-muted-foreground text-xs font-semibold uppercase">
            Section 2 · Post-edging measurements
          </h4>
          <MeasurementsTable rows={s2.post_edging} />
        </div>
      )}

      {hasSection4 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-muted-foreground text-xs font-semibold uppercase">
            Section 4 · Recommendations
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {electric && (
              <DetailRow label="Electric equipment" value={electric} />
            )}
            <DetailRow
              label="Staff trained"
              value={s4.staff_trained ? "Yes" : "No"}
            />
            <DetailRow
              label="Public signage present"
              value={s4.public_signage ? "Yes" : "No"}
            />
          </div>
          {s4.unusual_observations && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                Unusual observations or complaints
              </span>
              <p className="bg-muted/30 rounded-md border p-3 text-sm whitespace-pre-wrap">
                {s4.unusual_observations}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function fmtRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  if (min === null) return `≤ ${max}`
  if (max === null) return `≥ ${min}`
  return `${min} – ${max}`
}

function ReadingValue({ reading }: { reading: ReadingRow }) {
  const compliance = fmtRange(
    reading.compliance_min_at_submit,
    reading.compliance_max_at_submit,
  )
  const sev = reading.severity_at_submit as Severity | null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "font-medium",
            reading.is_exceedance && "text-destructive",
          )}
        >
          {reading.value_numeric}
        </span>
        <span className="text-muted-foreground text-xs">
          {reading.unit_snapshot}
        </span>
        {reading.is_exceedance && (
          <Badge
            variant={severityBadgeVariant(sev)}
            className="uppercase"
          >
            Exceedance{sev ? ` · ${sev}` : ""}
          </Badge>
        )}
      </div>
      {compliance && (
        <span className="text-muted-foreground text-xs">
          Compliance: {compliance} {reading.unit_snapshot}
        </span>
      )}
    </div>
  )
}

export function ReportDetail({ detail, backHref, timezone }: Props) {
  const fmt = (ts: string | null) => (ts ? formatInTz(ts, timezone) : "—")
  const { report, location, equipment, employee, readings, notes } = detail
  const [noteState, noteAction, notePending] = useActionState(
    addAirQualityFollowupNote,
    NOTE_INITIAL,
  )

  useEffect(() => {
    if (noteState.ok === false) toast.error(noteState.error)
    if (noteState.ok === true)
      toast.success(noteState.message ?? "Note added.")
  }, [noteState])

  const sev = (report.max_severity as Severity | null) ?? null
  const formData = asFormData(report.form_data)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>Air quality report</CardTitle>
              {report.has_exceedance && (
                <Badge
                  variant={severityBadgeVariant(sev)}
                  className="uppercase"
                >
                  Exceedance{sev ? ` · ${sev}` : ""}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {location?.name ?? "Unknown location"}
              {equipment ? ` · ${equipment.name}` : ""} · submitted{" "}
              {fmt(report.submitted_at)} by{" "}
              {employee
                ? `${employee.first_name} ${employee.last_name}`
                : "Unknown"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>Back to list</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {report.notes && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Submitter notes</h3>
            <p className="bg-muted/30 rounded-md border p-3 text-sm whitespace-pre-wrap">
              {report.notes}
            </p>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            Recorded readings ({readings.length})
          </h3>
          {readings.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No readings recorded on this report.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="border-b px-3 py-2 text-left font-medium">
                      Reading
                    </th>
                    <th className="border-b px-3 py-2 text-left font-medium">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="border-b px-3 py-2 align-top">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {r.label_snapshot}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {r.key_snapshot}
                          </span>
                        </div>
                      </td>
                      <td className="border-b px-3 py-2 align-top">
                        <ReadingValue reading={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {formData && <MonitoringLogDetails data={formData} />}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Follow-up notes ({notes.length})
          </h3>
          <p className="text-muted-foreground text-xs">
            Notes are append-only and cannot be edited or deleted. The original
            report is immutable.
          </p>
          {notes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">
                      {n.author
                        ? `${n.author.first_name} ${n.author.last_name}`
                        : "Admin"}
                      {n.is_admin_note && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          (admin)
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {fmt(n.created_at)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                </li>
              ))}
            </ul>
          )}

          <form
            action={noteAction}
            className="bg-background mt-2 flex flex-col gap-2 rounded-md border p-3"
            key={noteState.ok === true ? `note-${notes.length}` : "note-form"}
          >
            <input type="hidden" name="report_id" value={report.id} />
            <label htmlFor="aqfn-body" className="text-sm font-medium">
              Add follow-up note
            </label>
            <Textarea
              id="aqfn-body"
              name="body"
              required
              rows={3}
              placeholder="Visible to admins on this report."
            />
            {noteState.ok === false && (
              <p role="alert" className="text-destructive text-sm">
                {noteState.error}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={notePending}>
                {notePending ? "Adding…" : "Add note"}
              </Button>
            </div>
          </form>
        </section>
      </CardContent>
    </Card>
  )
}
