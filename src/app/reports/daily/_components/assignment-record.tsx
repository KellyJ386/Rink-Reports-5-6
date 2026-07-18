import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { Card } from "@/components/ui/card"

import type { AssignmentRecordDay } from "../_lib/assignments"

// Frozen assignment record for closed days (D5/D8): per area, a permanent
// "Completed by X" or "Assigned to X — not completed" flag from the day-close
// snapshots (migration 185). Shared by the staff history page and the admin
// Submissions tab. Days/areas that were open (unassigned) have no snapshot
// rows and render exactly as before the feature; renders nothing when there
// are no snapshots (routing never enabled).

function formatRecordDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`))
  } catch {
    return iso
  }
}

function names(people: { name: string }[]): string {
  return people.map((p) => p.name).join(", ")
}

export function AssignmentRecordCard({ days }: { days: AssignmentRecordDay[] }) {
  if (days.length === 0) return null
  return (
    <Card className="gap-4 py-5">
      <h2 className="px-6 text-lg font-semibold tracking-tight">
        Assignment record
      </h2>
      <div className="flex flex-col gap-4 px-6">
        {days.map((day) => (
          <div key={day.date} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {formatRecordDate(day.date)}
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border bg-background">
              {day.areas.map((area) => (
                <li
                  key={area.areaId}
                  className="flex items-start gap-3 px-4 py-2.5"
                >
                  {area.completed ? (
                    <CheckCircle2
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    />
                  ) : (
                    <AlertTriangle
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                    />
                  )}
                  <span className="flex min-w-0 flex-col text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {area.areaColor ? (
                        <span
                          aria-hidden
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: area.areaColor }}
                        />
                      ) : null}
                      {area.areaName}
                    </span>
                    {area.completed ? (
                      <span className="text-muted-foreground">
                        Completed by{" "}
                        {names(area.completedBy) || "an unrecorded submitter"}
                      </span>
                    ) : (
                      <span className="text-destructive">
                        Assigned to {names(area.assignees) || "—"} — not
                        completed
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}
