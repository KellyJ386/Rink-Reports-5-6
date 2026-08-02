import { dayPartsInTz } from "@/lib/timezone"

import { ClaimOpenShiftButton } from "./claim-open-shift-button"
import { formatDateTime } from "./format-utils"
import type { ClaimableOpenShift } from "../_lib/open-shifts"

// Shared "pick up" UI for the staff scheduling surfaces. The hub and My
// Schedule both render these, so the cards and copy stay identical; the data
// comes from ../_lib/open-shifts.

const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  )
}

/** Facility-local day chip — the same one the hub's upcoming list uses. */
function DayChip({
  startsAt,
  timezone,
}: {
  startsAt: string
  timezone: string | null
}) {
  const parts = dayPartsInTz(startsAt, timezone)
  return (
    <div className="grid h-12 w-11 shrink-0 place-items-center rounded-[10px] border border-border bg-secondary text-center text-foreground">
      <div className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
        {DAY_LABELS[parts.dayOfWeek]}
      </div>
      <div className="font-display text-xl leading-none">
        {parts.dayOfMonth}
      </div>
    </div>
  )
}

/**
 * Shifts anyone with scheduling access may claim. Renders nothing when empty,
 * so a page that includes it is visually unchanged for a facility with no open
 * shifts.
 */
export function OpenShiftsSection({
  rows,
  timezone,
  heading = "Open · Pick up",
}: {
  rows: ClaimableOpenShift[]
  timezone: string | null
  heading?: string
}) {
  if (rows.length === 0) return null

  return (
    <section>
      <SectionHeading>{heading}</SectionHeading>
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const shift = row.schedule_shifts
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-[14px] border border-primary/30 bg-primary/5 px-3.5 py-3"
            >
              <DayChip startsAt={shift.starts_at} timezone={timezone} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-foreground">
                  {formatDateTime(shift.starts_at, timezone)}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {shift.departments?.name ?? "—"}
                  {shift.role_label ? ` · ${shift.role_label}` : ""}
                  {row.approval_required ? " · Approval req." : ""}
                </div>
              </div>
              <ClaimOpenShiftButton openShiftId={row.id} />
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The caller's own claims still waiting on an admin. Without this a claimed
 * shift vanishes from the open list with no trace for the person who claimed it.
 */
export function MyPendingClaimsSection({
  rows,
  timezone,
}: {
  rows: ClaimableOpenShift[]
  timezone: string | null
}) {
  if (rows.length === 0) return null

  return (
    <section>
      <SectionHeading>Your claims · Awaiting approval</SectionHeading>
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const shift = row.schedule_shifts
          return (
            <div
              key={row.id}
              className="flex items-center gap-3 rounded-[14px] border border-dashed border-border bg-card px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-foreground">
                  {formatDateTime(shift.starts_at, timezone)}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {shift.departments?.name ?? "—"}
                  {shift.role_label ? ` · ${shift.role_label}` : ""}
                  {" · You claimed this shift — a manager needs to approve it."}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
