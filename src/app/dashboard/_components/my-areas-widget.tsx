import Link from "next/link"
import { ArrowRight, ClipboardList } from "lucide-react"

import { getMyAreasToday } from "@/app/reports/daily/_lib/assignments"

// Dashboard widget for daily-report area assignments (D7): compact
// complete/total count + the first incomplete area, linking into the
// "My Areas Today" landing view. Renders nothing when routing is off or the
// caller has no assignments today, so the dashboard is unchanged for
// facilities that haven't enabled the feature. Any failure degrades to null
// (same resilience posture as the module status bubbles).
export async function MyAreasWidget() {
  let data: Awaited<ReturnType<typeof getMyAreasToday>>
  try {
    data = await getMyAreasToday()
  } catch {
    return null
  }
  if (!data.ok || !data.data.routingEnabled || data.data.myAreas.length === 0) {
    return null
  }

  const areas = data.data.myAreas
  const done = areas.filter((a) => a.done).length
  const nextUp = areas.find((a) => !a.done) ?? null

  return (
    <Link
      href="/reports/daily"
      className="group mb-6 block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-brand)]/55"
    >
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-[var(--shadow-elev-1)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-elev-2)]">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{
            background:
              "color-mix(in oklab, var(--module-daily) 18%, transparent)",
            color: "var(--module-daily)",
          }}
        >
          <ClipboardList className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">My areas today</span>
          <span className="truncate text-sm text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">
              {done}/{areas.length}
            </span>{" "}
            complete
            {nextUp ? <> · next up: {nextUp.name}</> : " — all done"}
          </span>
        </div>
        <ArrowRight
          aria-hidden
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  )
}
