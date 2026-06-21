import Link from "next/link"
import { redirect } from "next/navigation"
import { Check, Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { USARink } from "@/components/ice-depth/usa-rink"
import { rinkCoords, type RinkPointSpec } from "@/components/ice-depth/rink-geometry"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { PrintDiagramButton } from "./_components/print-diagram-button"
import { SendReportButton } from "./_components/send-report-button"

export const dynamic = "force-dynamic"

type SearchParams = { id?: string | string[] }
type RouteParams = { layoutSlug: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DISPLAY_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

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

// Severity data palette — the app's semantic tokens so the markers and list
// adapt to light/dark. These land on SVG fill/stroke attributes in USARink
// (var() resolves there in modern browsers) and as color-mix tints below.
const DONE_COLORS: Record<SeverityKey, string> = {
  ok:   "var(--success)",
  low:  "var(--destructive)",
  high: "var(--warning)",
}

// Per-severity Tailwind classes for the stat pills + list (token-driven).
const SEV_PILL_CLASS: Record<SeverityKey, string> = {
  ok:   "text-success border-success/30 bg-success/10",
  low:  "text-destructive border-destructive/30 bg-destructive/10",
  high: "text-warning border-warning/30 bg-warning/10",
}

type LoadFailure = {
  stage: string
  code?: string | null
  message: string
  hint?: string | null
  details?: string | null
  extra?: Record<string, unknown>
}

type LoadResult =
  | { kind: "ok"; data: DonePageBodyProps }
  | { kind: "fail"; failure: LoadFailure }

async function loadDonePageData(
  layoutSlug: string,
  idParam: string,
): Promise<LoadResult> {
  try {
    const supabase = await createClient()

    const sessionRes = await supabase
      .from("ice_depth_sessions")
      .select(
        "id, submitted_at, notes, facility_id, layout_id, total_measurements, low_count, high_count, has_low_reading, has_high_reading, measurement_unit_snapshot, low_threshold_snapshot, high_threshold_snapshot"
      )
      .eq("id", idParam)
      .maybeSingle()

    if (sessionRes.error) {
      return {
        kind: "fail",
        failure: {
          stage: "select ice_depth_sessions",
          code: sessionRes.error.code,
          message: sessionRes.error.message,
          hint: sessionRes.error.hint ?? null,
          details: sessionRes.error.details ?? null,
          extra: { idParam },
        },
      }
    }
    const session = sessionRes.data
    if (!session) {
      return {
        kind: "fail",
        failure: {
          stage: "session lookup",
          message: "No ice_depth_sessions row found for the supplied id.",
          extra: { idParam },
        },
      }
    }

    const layoutRes = await supabase
      .from("ice_depth_layouts")
      .select("id, name, slug, diagram_aspect_ratio, logo_url")
      .eq("id", session.layout_id)
      .maybeSingle()

    if (layoutRes.error) {
      return {
        kind: "fail",
        failure: {
          stage: "select ice_depth_layouts",
          code: layoutRes.error.code,
          message: layoutRes.error.message,
          hint: layoutRes.error.hint ?? null,
          details: layoutRes.error.details ?? null,
          extra: { layout_id: session.layout_id },
        },
      }
    }
    const layout = layoutRes.data
    if (!layout) {
      return {
        kind: "fail",
        failure: {
          stage: "layout lookup",
          message: "No ice_depth_layouts row matched session.layout_id.",
          extra: { layout_id: session.layout_id },
        },
      }
    }
    if (layout.slug !== layoutSlug) {
      return {
        kind: "fail",
        failure: {
          stage: "layout slug check",
          message: `URL slug "${layoutSlug}" does not match session's layout slug "${layout.slug}".`,
          extra: { layoutSlug, sessionLayoutSlug: layout.slug },
        },
      }
    }

    const [measurementsResult, facilityResult] = await Promise.all([
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

    if (measurementsResult.error) {
      return {
        kind: "fail",
        failure: {
          stage: "select ice_depth_measurements",
          code: measurementsResult.error.code,
          message: measurementsResult.error.message,
          hint: measurementsResult.error.hint ?? null,
          details: measurementsResult.error.details ?? null,
          extra: { session_id: session.id },
        },
      }
    }
    if (facilityResult.error) {
      return {
        kind: "fail",
        failure: {
          stage: "select facilities",
          code: facilityResult.error.code,
          message: facilityResult.error.message,
          hint: facilityResult.error.hint ?? null,
          details: facilityResult.error.details ?? null,
          extra: { facility_id: session.facility_id },
        },
      }
    }

    const measurements = measurementsResult.data ?? []
    const tz = facilityResult.data?.timezone ?? null
    const unit = session.measurement_unit_snapshot

    const rinkPoints: RinkPointSpec[] = measurements.map((m) => {
      const { cx, cy } = rinkCoords(m.x_snapshot ?? 0, m.y_snapshot ?? 0)
      const sev = (m.severity as SeverityKey) ?? "ok"
      return {
        id: m.id,
        pointNumber: m.point_number_snapshot ?? 0,
        cx,
        cy,
        state: "done",
        doneColor: DONE_COLORS[sev],
        depthValue: m.depth_value,
      }
    })

    const totalOk = measurements.filter((m) => m.severity === "ok").length
    const totalLow = session.low_count ?? 0
    const totalHigh = session.high_count ?? 0

    return {
      kind: "ok",
      data: {
        layout,
        session,
        measurements,
        tz,
        unit,
        rinkPoints,
        totalOk,
        totalLow,
        totalHigh,
      },
    }
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "digest" in e &&
      typeof (e as { digest?: unknown }).digest === "string" &&
      (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw e
    }
    const err = e instanceof Error ? e : new Error(String(e))
    return {
      kind: "fail",
      failure: {
        stage: "data prep",
        message: err.message,
        details: err.stack ?? null,
        extra: { name: err.name },
      },
    }
  }
}

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

  const result = await loadDonePageData(layoutSlug, idParam)
  if (result.kind === "fail") {
    console.error(
      "[ice-depth/done] load failed",
      JSON.stringify(result.failure),
    )
    redirect("/reports/ice-depth")
  }
  return <DonePageBody {...result.data} />
}

type DonePageBodyProps = {
  layout: { id: string; name: string; slug: string; diagram_aspect_ratio: number; logo_url: string | null }
  session: {
    id: string
    submitted_at: string
    notes: string | null
    facility_id: string
    layout_id: string
    total_measurements: number | null
    low_count: number | null
    high_count: number | null
    has_low_reading: boolean | null
    has_high_reading: boolean | null
    measurement_unit_snapshot: string | null
    low_threshold_snapshot: number | null
    high_threshold_snapshot: number | null
  }
  measurements: Array<{
    id: string
    depth_value: number | null
    severity: string | null
    point_number_snapshot: number | null
    label_snapshot: string | null
    x_snapshot: number | null
    y_snapshot: number | null
  }>
  tz: string | null
  unit: string | null
  rinkPoints: RinkPointSpec[]
  totalOk: number
  totalLow: number
  totalHigh: number
}

function DonePageBody({
  layout,
  session,
  measurements,
  tz,
  rinkPoints,
  totalOk,
  totalLow,
  totalHigh,
}: DonePageBodyProps) {

  return (
    <div className="flex min-h-full flex-col bg-background">
      {/* Print: show only the rink diagram, full-page on US Letter portrait. */}
      <style>{`@media print {
        .ice-print-hide { display: none !important; }
        .ice-print-area { padding: 0 !important; }
        .ice-print-diagram { max-width: none !important; height: 9.4in !important; width: auto !important; aspect-ratio: 380 / 740; margin: 0 auto !important; border: none !important; }
        .ice-print-diagram svg { border: none !important; border-radius: 0 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { size: letter portrait; margin: 0.5in; }
      }`}</style>

      {/* Print-only caption (rink name + timestamp) above the diagram. */}
      <div className="hidden text-center print:block">
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "24px",
            textTransform: "uppercase",
            color: "#000",
            lineHeight: 1,
          }}
        >
          {layout.name}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatTimestamp(session.submitted_at, tz)}
        </div>
      </div>

      {/* Hero — success checkmark + submitted badge */}
      <div className="ice-print-hide flex flex-col items-center gap-[14px] border-b border-border px-5 pb-7 pt-10 text-center">
        {/* Success circle checkmark */}
        <div
          aria-hidden
          className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-success bg-success/10"
          style={{
            boxShadow:
              "0 0 32px color-mix(in srgb, var(--success) 20%, transparent)",
          }}
        >
          <Check className="h-10 w-10 text-success" strokeWidth={3} />
        </div>

        {/* SUBMITTED badge */}
        <div className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-4 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-success">
          Submitted
        </div>

        <div>
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: "clamp(26px, 6vw, 36px)",
              textTransform: "uppercase",
              color: "var(--foreground)",
              lineHeight: 1,
              letterSpacing: "0.01em",
            }}
          >
            {layout.name}
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {formatTimestamp(session.submitted_at, tz)}
          </div>
        </div>

        {/* Stats pills */}
        <div className="flex flex-wrap justify-center gap-2">
          <StatPill
            tone="ok"
            label="Optimal"
            value={totalOk}
            active={totalOk > 0}
          />
          <StatPill
            tone="low"
            label="Below min"
            value={totalLow}
            active={totalLow > 0}
          />
          <StatPill
            tone="high"
            label="Above target"
            value={totalHigh}
            active={totalHigh > 0}
          />
          <StatPill
            tone="muted"
            label="Total"
            value={session.total_measurements ?? 0}
            active={false}
          />
        </div>
      </div>

      {/* Rink + point list */}
      <div className="ice-print-area flex flex-col gap-4 px-4 py-5">
        {measurements.length > 0 && (
          <div className="ice-print-diagram mx-auto w-full max-w-[280px]" style={{ aspectRatio: "380/740" }}>
            <USARink
              points={rinkPoints}
              showValues
              logoUrl={layout.logo_url ?? null}
              style={{
                borderRadius: 12,
                border: "1px solid var(--border)",
              }}
            />
          </div>
        )}

        {measurements.length === 0 && (
          <div className="ice-print-hide rounded-xl border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
            No measurements were recorded in this session.
          </div>
        )}

        {session.notes && (
          <div className="ice-print-hide rounded-xl border border-border bg-card px-4 py-[14px]">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Notes
            </div>
            <p className="m-0 whitespace-pre-wrap text-[13px] text-foreground">
              {session.notes}
            </p>
          </div>
        )}

        {/* CTAs */}
        <div className="ice-print-hide flex flex-col gap-[10px] pb-4">
          {measurements.length > 0 && (
            <>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="min-h-11 w-full text-sm font-semibold text-muted-foreground"
              >
                <a
                  href={`/reports/ice-depth/${layout.slug}/done/pdf?id=${session.id}`}
                  download
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Download PDF
                </a>
              </Button>
              <PrintDiagramButton />
              <SendReportButton sessionId={session.id} />
            </>
          )}
          {measurements.length > 0 && <SendReportButton sessionId={session.id} />}
          {measurements.length > 0 && <PrintDiagramButton />}
          <Button
            asChild
            size="lg"
            className="min-h-[52px] w-full text-lg uppercase tracking-[0.02em]"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            <Link href="/reports/ice-depth">Submit Another</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="min-h-11 w-full text-sm font-semibold text-muted-foreground"
          >
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatPill({
  tone,
  label,
  value,
  active,
}: {
  tone: SeverityKey | "muted"
  label: string
  value: number
  active: boolean
}) {
  const toneClass =
    active && tone !== "muted"
      ? SEV_PILL_CLASS[tone]
      : "text-muted-foreground border-border bg-muted/40"
  return (
    <div
      className={`inline-flex items-center gap-[5px] rounded-full border px-3 py-1 ${toneClass}`}
    >
      <span
        className="text-sm font-bold"
        style={{ fontFamily: "var(--font-geist-mono), monospace" }}
      >
        {value}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.06em] opacity-80">
        {label}
      </span>
    </div>
  )
}
