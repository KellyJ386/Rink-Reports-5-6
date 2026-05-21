import Link from "next/link"
import { redirect } from "next/navigation"

import { USARink, rinkCoords, type RinkPointSpec } from "@/components/ice-depth/usa-rink"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

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

const DONE_COLORS: Record<SeverityKey, string> = {
  ok:   "#4DFF00",
  low:  "#F42A2A",
  high: "#FFB800",
}

const SEV_LABEL: Record<SeverityKey, string> = {
  ok:   "Optimal",
  low:  "Below min",
  high: "Above target",
}

type Diagnostic = {
  stage: string
  code?: string | null
  message: string
  hint?: string | null
  details?: string | null
  extra?: Record<string, unknown>
}

function DiagnosticPanel({ items }: { items: Diagnostic[] }) {
  return (
    <div
      style={{
        margin: 24,
        padding: 20,
        borderRadius: 12,
        background: "#1a0606",
        border: "2px solid #F42A2A",
        color: "#fff",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Diagnostic — ice-depth done page
      </div>
      {items.map((d, i) => (
        <div
          key={i}
          style={{
            marginBottom: 14,
            paddingBottom: 14,
            borderBottom:
              i < items.length - 1 ? "1px dashed rgba(255,255,255,0.2)" : "none",
          }}
        >
          <div style={{ fontWeight: 700, color: "#F42A2A" }}>
            STAGE: {d.stage}
          </div>
          {d.code != null && d.code !== "" && (
            <div>CODE: {String(d.code)}</div>
          )}
          <div>MESSAGE: {d.message}</div>
          {d.hint != null && d.hint !== "" && <div>HINT: {String(d.hint)}</div>}
          {d.details != null && d.details !== "" && (
            <div>DETAILS: {String(d.details)}</div>
          )}
          {d.extra && (
            <div>
              EXTRA:{" "}
              {JSON.stringify(d.extra, (_k, v) => {
                if (v instanceof Error) {
                  return { name: v.name, message: v.message, stack: v.stack }
                }
                return v
              }, 2)}
            </div>
          )}
        </div>
      ))}
      <Link
        href="/reports/ice-depth"
        style={{
          display: "inline-block",
          marginTop: 8,
          padding: "8px 14px",
          borderRadius: 6,
          background: "#fff",
          color: "#111",
          textDecoration: "none",
          fontWeight: 700,
        }}
      >
        ← Back
      </Link>
    </div>
  )
}

type LoadResult =
  | { kind: "ok"; data: DonePageBodyProps }
  | { kind: "fail"; diagnostics: Diagnostic[] }

async function loadDonePageData(
  layoutSlug: string,
  idParam: string,
): Promise<LoadResult> {
  const diagnostics: Diagnostic[] = []
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
      diagnostics.push({
        stage: "select ice_depth_sessions",
        code: sessionRes.error.code,
        message: sessionRes.error.message,
        hint: sessionRes.error.hint ?? null,
        details: sessionRes.error.details ?? null,
        extra: { idParam },
      })
      return { kind: "fail", diagnostics }
    }
    const session = sessionRes.data
    if (!session) {
      diagnostics.push({
        stage: "session lookup",
        message: "No ice_depth_sessions row found for the supplied id.",
        extra: { idParam },
      })
      return { kind: "fail", diagnostics }
    }

    const layoutRes = await supabase
      .from("ice_depth_layouts")
      .select("id, name, slug, diagram_aspect_ratio, logo_url")
      .eq("id", session.layout_id)
      .maybeSingle()

    if (layoutRes.error) {
      diagnostics.push({
        stage: "select ice_depth_layouts",
        code: layoutRes.error.code,
        message: layoutRes.error.message,
        hint: layoutRes.error.hint ?? null,
        details: layoutRes.error.details ?? null,
        extra: { layout_id: session.layout_id },
      })
      return { kind: "fail", diagnostics }
    }
    const layout = layoutRes.data
    if (!layout) {
      diagnostics.push({
        stage: "layout lookup",
        message: "No ice_depth_layouts row matched session.layout_id.",
        extra: { layout_id: session.layout_id },
      })
      return { kind: "fail", diagnostics }
    }
    if (layout.slug !== layoutSlug) {
      diagnostics.push({
        stage: "layout slug check",
        message: `URL slug "${layoutSlug}" does not match session's layout slug "${layout.slug}".`,
        extra: { layoutSlug, sessionLayoutSlug: layout.slug },
      })
      return { kind: "fail", diagnostics }
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
      diagnostics.push({
        stage: "select ice_depth_measurements",
        code: measurementsResult.error.code,
        message: measurementsResult.error.message,
        hint: measurementsResult.error.hint ?? null,
        details: measurementsResult.error.details ?? null,
        extra: { session_id: session.id },
      })
    }
    if (facilityResult.error) {
      diagnostics.push({
        stage: "select facilities",
        code: facilityResult.error.code,
        message: facilityResult.error.message,
        hint: facilityResult.error.hint ?? null,
        details: facilityResult.error.details ?? null,
        extra: { facility_id: session.facility_id },
      })
    }
    if (diagnostics.length > 0) return { kind: "fail", diagnostics }

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
      diagnostics: [
        {
          stage: "data prep",
          message: err.message,
          details: err.stack ?? null,
          extra: { name: err.name },
        },
      ],
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
    return <DiagnosticPanel items={result.diagnostics} />
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
  unit,
  rinkPoints,
  totalOk,
  totalLow,
  totalHigh,
}: DonePageBodyProps) {

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: "var(--background)",
      }}
    >
      {/* Hero — green checkmark + submitted badge */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "40px 20px 28px",
          borderBottom: "1px solid var(--border)",
          gap: 14,
          textAlign: "center",
        }}
      >
        {/* Green circle checkmark */}
        <div
          aria-hidden
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "rgba(77,255,0,0.12)",
            border: "2px solid #4DFF00",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 32px rgba(77,255,0,0.20)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#4DFF00"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 40, height: 40 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        {/* SUBMITTED badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 16px",
            borderRadius: 9999,
            background: "rgba(77,255,0,0.12)",
            border: "1px solid rgba(77,255,0,0.3)",
            color: "#4DFF00",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
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
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {formatTimestamp(session.submitted_at, tz)}
          </div>
        </div>

        {/* Stats pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          <StatPill
            color="#4DFF00"
            label="Optimal"
            value={totalOk}
            active={totalOk > 0}
          />
          <StatPill
            color="#F42A2A"
            label="Below min"
            value={totalLow}
            active={totalLow > 0}
          />
          <StatPill
            color="#FFB800"
            label="Above target"
            value={totalHigh}
            active={totalHigh > 0}
          />
          <StatPill
            color="var(--muted-foreground)"
            label="Total"
            value={session.total_measurements ?? 0}
            active={false}
          />
        </div>
      </div>

      {/* Rink + point list */}
      <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {measurements.length > 0 && (
          <div className="mx-auto w-full max-w-[280px]" style={{ aspectRatio: "380/740" }}>
            <USARink
              points={rinkPoints}
              showValues
              logoUrl={layout.logo_url ?? null}
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
          </div>
        )}

        {measurements.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {measurements.map((m, i) => {
              const sev = (m.severity as SeverityKey) ?? "ok"
              const color = DONE_COLORS[sev]
              return (
                <li
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 14px",
                    borderBottom:
                      i < measurements.length - 1
                        ? "1px solid var(--border)"
                        : "none",
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9999,
                      background: `${color}22`,
                      border: `1px solid ${color}55`,
                      color: color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {m.point_number_snapshot}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                      {m.label_snapshot ?? `Point ${m.point_number_snapshot}`}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: color,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      {SEV_LABEL[sev]}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                    <span
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 15,
                        fontWeight: 700,
                        color: "var(--foreground)",
                        fontFamily: "var(--font-geist-mono), monospace",
                      }}
                    >
                      {m.depth_value}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{unit}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {measurements.length === 0 && (
          <div
            style={{
              padding: "24px 16px",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              textAlign: "center",
              fontSize: 13,
              color: "var(--muted-foreground)",
            }}
          >
            No measurements were recorded in this session.
          </div>
        )}

        {session.notes && (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--muted-foreground)",
                marginBottom: 6,
              }}
            >
              Notes
            </div>
            <p style={{ fontSize: 13, color: "var(--foreground)", whiteSpace: "pre-wrap", margin: 0 }}>
              {session.notes}
            </p>
          </div>
        )}

        {/* CTAs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 16 }}>
          <Link
            href="/reports/ice-depth"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              minHeight: 52,
              borderRadius: 10,
              background: "linear-gradient(180deg, #7AFF40 0%, #4DFF00 100%)",
              color: "#051200",
              fontFamily: DISPLAY_FONT,
              fontSize: 18,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.02em",
              textDecoration: "none",
              boxShadow: "0 2px 0 0 #2E9900, 0 4px 12px rgba(77,255,0,0.25)",
            }}
          >
            Submit Another
          </Link>
          <Link
            href="/dashboard"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted-foreground)",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}

function StatPill({
  color,
  label,
  value,
  active,
}: {
  color: string
  label: string
  value: number
  active: boolean
}) {
  const activeColor = active ? color : "var(--muted-foreground)"
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 12px",
        borderRadius: 9999,
        background: active ? `${color}15` : "rgba(255,255,255,0.04)",
        border: `1px solid ${active ? `${color}30` : "rgba(255,255,255,0.08)"}`,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 14,
          fontWeight: 700,
          color: activeColor,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: activeColor,
          opacity: 0.8,
        }}
      >
        {label}
      </span>
    </div>
  )
}
