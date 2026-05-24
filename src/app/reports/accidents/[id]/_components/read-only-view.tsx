import { BodyDiagram } from "@/components/staff/body-diagram/body-diagram"
import {
  EMPTY_BODY_SELECTIONS,
  isBodyLaterality,
  isBodyPartKey,
  isBodySide,
  selectionKey,
  type BodyPartKey,
  type BodySelections,
} from "@/components/staff/body-diagram/types"
import { Card, CardContent } from "@/components/ui/card"

type ReportRow = {
  id: string
  injured_person_name: string
  injured_person_contact: string
  injured_person_age: number | null
  description: string
  occurred_at: string
  submitted_at: string
  edit_window_ends_at: string
  workers_comp: boolean
  workers_comp_acknowledged_at: string | null
  location_dropdown_id: string | null
  activity_dropdown_id: string | null
  severity_dropdown_id: string | null
  medical_attention_dropdown_id: string | null
  primary_injury_type_dropdown_id: string | null
}

type BodyPartRow = {
  id: string
  body_part_dropdown_id: string
  side: string
  laterality: string
}

type WitnessRow = {
  id: string
  name: string
  contact: string | null
  statement: string | null
  sort_order: number
}

type DropdownRow = {
  id: string
  category: string
  key: string
  display_name: string
  color: string | null
}

type Props = {
  report: ReportRow
  bodyPartRows: BodyPartRow[]
  witnesses: WitnessRow[]
  dropdownsById: Map<string, DropdownRow>
  timezone: string | null
  editWindowOpen: boolean
}

function formatTimestamp(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

function buildSelections(
  rows: BodyPartRow[],
  dropdownsById: Map<string, DropdownRow>
): BodySelections {
  const out: BodySelections = { ...EMPTY_BODY_SELECTIONS }
  for (const r of rows) {
    const dd = dropdownsById.get(r.body_part_dropdown_id)
    if (!dd) continue
    const key: string = dd.key
    if (!isBodyPartKey(key)) continue
    const laterality = isBodyLaterality(r.laterality) ? r.laterality : "center"
    if (isBodySide(r.side) && r.side !== "none") {
      out[selectionKey(key as BodyPartKey, laterality)] = r.side
    }
  }
  return out
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{value ?? "—"}</span>
    </div>
  )
}

export function ReadOnlyView({
  report,
  bodyPartRows,
  witnesses,
  dropdownsById,
  timezone,
  editWindowOpen,
}: Props) {
  const selections = buildSelections(bodyPartRows, dropdownsById)
  const lookup = (id: string | null): string | null =>
    id ? dropdownsById.get(id)?.display_name ?? null : null

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 py-6 text-sm">
          <DetailRow
            label="Injured person"
            value={report.injured_person_name}
          />
          <DetailRow label="Contact" value={report.injured_person_contact} />
          <DetailRow
            label="Age"
            value={
              report.injured_person_age === null ||
              report.injured_person_age === undefined
                ? null
                : String(report.injured_person_age)
            }
          />
          <DetailRow
            label="When it happened"
            value={formatTimestamp(report.occurred_at, timezone)}
          />
          <DetailRow
            label="Submitted"
            value={formatTimestamp(report.submitted_at, timezone)}
          />
          <DetailRow
            label="Location"
            value={lookup(report.location_dropdown_id)}
          />
          <DetailRow
            label="Activity"
            value={lookup(report.activity_dropdown_id)}
          />
          <DetailRow
            label="Severity"
            value={lookup(report.severity_dropdown_id)}
          />
          <DetailRow
            label="Medical attention"
            value={lookup(report.medical_attention_dropdown_id)}
          />
          <DetailRow
            label="Primary injury type"
            value={lookup(report.primary_injury_type_dropdown_id)}
          />
          <DetailRow
            label="Workers' comp"
            value={report.workers_comp ? "Yes" : "No"}
          />
          {report.workers_comp && report.workers_comp_acknowledged_at ? (
            <DetailRow
              label="WC instructions acknowledged"
              value={formatTimestamp(
                report.workers_comp_acknowledged_at,
                timezone
              )}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 py-6 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Description
          </p>
          <p className="whitespace-pre-wrap">{report.description}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Body parts affected
          </p>
          <BodyDiagram selections={selections} readOnly />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Witnesses ({witnesses.length})
          </p>
          {witnesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No witnesses recorded.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {witnesses.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{w.name}</span>
                    {w.contact ? (
                      <span className="text-xs text-muted-foreground">
                        {w.contact}
                      </span>
                    ) : null}
                  </div>
                  {w.statement ? (
                    <p className="whitespace-pre-wrap text-sm">{w.statement}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!editWindowOpen ? (
        <p className="text-xs text-muted-foreground">
          The 24-hour edit window has closed. Contact a manager if you need to
          change this report.
        </p>
      ) : null}
    </div>
  )
}
