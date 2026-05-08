import Link from "next/link"
import { redirect } from "next/navigation"

import { USARink, rinkCoords, type RinkPointSpec } from "@/components/ice-depth/usa-rink"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

type SearchParams = {
  id?: string | string[]
}

type RouteParams = {
  layoutSlug: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

type SeverityKey = "ok" | "low" | "high"

export default async function IceDepthDonePage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>
  searchParams: Promise<SearchParams>
}) {
  await requireUser()
  const [{ layoutSlug }, sp] = await Promise.all([params, searchParams])
  const idParam = Array.isArray(sp.id) ? sp.id[0] : sp.id

  if (!idParam || !UUID_RE.test(idParam)) {
    redirect("/reports/ice-depth")
  }

  const supabase = await createClient()

  const { data: session } = await supabase
    .from("ice_depth_sessions")
    .select(
      "id, submitted_at, notes, facility_id, layout_id, total_measurements, low_count, high_count, has_low_reading, has_high_reading, measurement_unit_snapshot, low_threshold_snapshot, high_threshold_snapshot"
    )
    .eq("id", idParam)
    .maybeSingle()

  if (!session) {
    redirect("/reports/ice-depth")
  }

  const { data: layout } = await supabase
    .from("ice_depth_layouts")
    .select("id, name, slug, diagram_aspect_ratio")
    .eq("id", session.layout_id)
    .maybeSingle()

  if (!layout || layout.slug !== layoutSlug) {
    redirect("/reports/ice-depth")
  }

  const [{ data: measurementsRaw }, { data: facility }] = await Promise.all([
    supabase
      .from("ice_depth_measurements")
      .select(
        "id, depth_value, severity, point_number_snapshot, label_snapshot, x_snapshot, y_snapshot"
      )
      .eq("session_id", session.id)
      .order("point_number_snapshot", { ascending: true }),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", session.facility_id)
      .maybeSingle(),
  ])

  const measurements = measurementsRaw ?? []
  const tz = facility?.timezone ?? null
  const unit = session.measurement_unit_snapshot

  const DONE_COLORS: Record<SeverityKey, string> = {
    ok: "#16a34a",
    low: "#dc2626",
    high: "#d97706",
  }

  const BG_FOR: Record<SeverityKey, string> = {
    ok: "bg-emerald-600",
    low: "bg-red-600",
    high: "bg-amber-600",
  }

  const rinkPoints: RinkPointSpec[] = measurements.map((m) => {
    const { cx, cy } = rinkCoords(m.x_snapshot, m.y_snapshot)
    const sev = (m.severity as SeverityKey) ?? "ok"
    return {
      id: m.id,
      pointNumber: m.point_number_snapshot,
      cx,
      cy,
      state: "done",
      doneColor: DONE_COLORS[sev],
      depthValue: m.depth_value,
    }
  })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <div
            aria-hidden
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Submitted!</h1>
          <p className="text-sm text-muted-foreground">{layout.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatTimestamp(session.submitted_at, tz)}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">
          Total: {session.total_measurements}
        </Badge>
        <Badge tone={session.has_low_reading ? "low" : "neutral"}>
          Low: {session.low_count}
        </Badge>
        <Badge tone={session.has_high_reading ? "high" : "neutral"}>
          High: {session.high_count}
        </Badge>
      </div>

      {measurements.length > 0 ? (
        <div className="mx-auto w-full max-w-xs" style={{ aspectRatio: "380/740" }}>
          <USARink
            points={rinkPoints}
            showValues
            className="rounded-xl border"
          />
        </div>
      ) : null}

      {measurements.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
          {measurements.map((m) => {
            const sev = (m.severity as SeverityKey) ?? "ok"
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
                      BG_FOR[sev]
                    )}
                  >
                    {m.point_number_snapshot}
                  </span>
                  <span className="font-medium">
                    {m.label_snapshot
                      ? m.label_snapshot
                      : `Point ${m.point_number_snapshot}`}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-base">
                    {m.depth_value}
                  </span>
                  <span className="text-xs text-muted-foreground">{unit}</span>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No measurements were recorded in this session.
          </CardContent>
        </Card>
      )}

      {session.notes ? (
        <Card>
          <CardContent className="py-4 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Notes
            </span>
            <p className="mt-2 whitespace-pre-wrap">{session.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 w-full text-base sm:flex-1">
          <Link href="/reports/ice-depth">Submit another</Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-12 w-full text-base sm:flex-1"
        >
          <Link href="/reports">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: "neutral" | "low" | "high"
  children: React.ReactNode
}) {
  const classes =
    tone === "low"
      ? "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200"
      : tone === "high"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
        : "bg-muted text-muted-foreground"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium",
        classes
      )}
    >
      {children}
    </span>
  )
}
