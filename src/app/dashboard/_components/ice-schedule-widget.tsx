import Link from "next/link"

import { RinkScheduleReadOnly } from "@/app/reports/rink-scheduling/_components/rink-schedule-readonly"
import { formatMinuteLabel } from "@/app/reports/rink-scheduling/_lib/grid-model"
import { formatInTz } from "@/lib/timezone"

import { getTodayIceSchedule } from "../_lib/ice-schedule"

/**
 * Dashboard widget: today's ice schedule across every active sheet, read
 * only. Renders nothing when the module is disabled for the caller, the
 * caller has no rink_scheduling view grant, or the facility has no active
 * rinks configured — same degrade-to-null posture as MyAreasWidget.
 *
 * This component and everything it imports (RinkScheduleReadOnly,
 * getTodayIceSchedule) touch zero rink-scheduling server actions. Editing
 * lives entirely on /reports/rink-scheduling, reached only through the
 * "Manage schedule" link below, itself shown only to an edit-tier
 * (facility_manager and above) caller — the link is a route hint, not an
 * authorization boundary: every mutation action on that page re-checks role
 * and re-derives facility_id from the session regardless of how it's
 * reached.
 */
export async function IceScheduleWidget() {
  let result: Awaited<ReturnType<typeof getTodayIceSchedule>>
  try {
    result = await getTodayIceSchedule()
  } catch {
    return null
  }
  if (!result.ok) return null
  const { data } = result
  if (data.rinks.length === 0) return null

  return (
    <section className="border-border bg-card shadow-[var(--shadow-elev-1)] mb-6 flex flex-col gap-4 rounded-2xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
          Ice Schedule — Today
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">
            Updated{" "}
            {formatInTz(data.asOf, data.timeZone, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {data.canManage && (
            <Link
              href="/reports/rink-scheduling"
              className="text-primary text-xs font-medium hover:underline"
            >
              Manage schedule →
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {data.rinks.map((rink) => (
          <div key={rink.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm border"
                style={{ backgroundColor: rink.color }}
              />
              <span className="text-sm font-medium">{rink.name}</span>
              {rink.nextResurface ? (
                <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
                  Next cut {formatMinuteLabel(rink.nextResurface.startMinute)}
                </span>
              ) : (
                <span className="text-muted-foreground text-[10px]">
                  No resurface left today
                </span>
              )}
            </div>
            <RinkScheduleReadOnly window={data.window} bookings={rink.bookings} />
          </div>
        ))}
      </div>
    </section>
  )
}
