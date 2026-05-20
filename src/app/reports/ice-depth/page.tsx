import Link from "next/link"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { SyncChip } from "./_components/sync-chip"

export const dynamic = "force-dynamic"

const DISPLAY_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

const NAVY = "#003B6F"
const GREEN = "#4DFF00"

// ── Mini rink thumbnail ───────────────────────────────────────────────────────

type PointThumbnail = { x_position: number; y_position: number }

function MiniRinkThumbnail({ points }: { points: PointThumbnail[] }) {
  return (
    <svg
      viewBox="0 0 380 740"
      width="48"
      height="92"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden
    >
      <rect
        x="62.5"
        y="70"
        width="255"
        height="600"
        rx="84"
        ry="84"
        fill="#0D2035"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="4"
      />
      <line
        x1="62.5" y1="370" x2="317.5" y2="370"
        stroke="#cc0000" strokeWidth="7" strokeDasharray="20 16"
      />
      <line x1="62.5" y1="262" x2="317.5" y2="262" stroke="#0044aa" strokeWidth="7" />
      <line x1="62.5" y1="478" x2="317.5" y2="478" stroke="#0044aa" strokeWidth="7" />
      <line x1="80" y1="103" x2="300" y2="103" stroke="#cc0000" strokeWidth="4" />
      <line x1="80" y1="637" x2="300" y2="637" stroke="#cc0000" strokeWidth="4" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x_position * 380}
          cy={p.y_position * 740}
          r="16"
          fill="#4DFF00"
          stroke="#081828"
          strokeWidth="3"
          opacity={0.9}
        />
      ))}
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initialsFor(first: string | null, last: string | null): string {
  const a = (first ?? "").trim()[0] ?? ""
  const b = (last ?? "").trim()[0] ?? ""
  return (a + b).toUpperCase() || "??"
}

function nameFor(first: string | null, last: string | null): string {
  const parts = [first, last].filter((s): s is string => !!s && s.trim().length > 0)
  return parts.length ? parts.join(" ") : "Unknown"
}

function formatStamp(iso: string, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz || undefined,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString()
  }
}

type ReadingStats = { optimal: number; low: number; high: number; total: number }

function statsFor(s: {
  total_measurements: number | null
  low_count: number | null
  high_count: number | null
}): ReadingStats {
  const total = s.total_measurements ?? 0
  const low = s.low_count ?? 0
  const high = s.high_count ?? 0
  return { optimal: Math.max(0, total - low - high), low, high, total }
}

// ── Reading status pill ───────────────────────────────────────────────────────

function ReadingPill({
  kind,
  children,
}: {
  kind: "success" | "warn" | "error" | "neutral"
  children: React.ReactNode
}) {
  const palette = {
    success: { bg: "rgba(77,255,0,0.15)", fg: "#3DB800", border: "rgba(77,255,0,0.35)" },
    warn:    { bg: "rgba(255,184,0,0.15)", fg: "#CC9300", border: "rgba(255,184,0,0.35)" },
    error:   { bg: "rgba(244,42,42,0.15)", fg: "#C62828", border: "rgba(244,42,42,0.35)" },
    neutral: { bg: "rgba(165,172,175,0.15)", fg: "#8A9194", border: "rgba(165,172,175,0.35)" },
  }[kind]
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 9999,
        lineHeight: "18px",
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </span>
  )
}

// ── Error / empty states ──────────────────────────────────────────────────────

function StateScreen({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: "clamp(22px, 5vw, 32px)",
          textTransform: "uppercase",
          color: "var(--foreground)",
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      <p style={{ fontSize: 14, color: "var(--muted-foreground)", maxWidth: 320 }}>
        {description}
      </p>
      <Link
        href="/dashboard"
        style={{
          marginTop: 8,
          padding: "10px 24px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--foreground)",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Back to Dashboard
      </Link>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function IceDepthHomePage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <StateScreen
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
      />
    )
  }

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "ice_depth")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return (
      <StateScreen
        title="No permission"
        description="You don't have permission to submit ice depth reports."
      />
    )
  }

  const [layoutsRes, recentSessionsRes, facilityRes] = await Promise.all([
    supabase
      .from("ice_depth_layouts")
      .select(
        "id, name, slug, description, sort_order, is_active, ice_depth_points(id, x_position, y_position, point_number, is_active)",
      )
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_depth_sessions")
      .select(
        "id, submitted_at, layout_id, employee_id, total_measurements, low_count, high_count, has_low_reading, has_high_reading",
      )
      .eq("facility_id", employeeRow.facility_id)
      .order("submitted_at", { ascending: false })
      .limit(4),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
  ])

  const layouts = (layoutsRes.data ?? []).map((l) => ({
    ...l,
    activePoints: ((l.ice_depth_points as PointThumbnail[] | null) ?? []).filter(
      // @ts-expect-error is_active comes back from the nested query
      (p) => p.is_active !== false,
    ),
  }))

  const recentSessions = recentSessionsRes.data ?? []
  const tz = facilityRes.data?.timezone ?? null

  const empIds = Array.from(
    new Set(
      recentSessions
        .map((s) => s.employee_id)
        .filter((x): x is string => !!x),
    ),
  )
  let employeeIndex = new Map<string, { first_name: string | null; last_name: string | null }>()
  if (empIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", empIds)
    employeeIndex = new Map(
      (emps ?? []).map((e) => [e.id, { first_name: e.first_name, last_name: e.last_name }]),
    )
  }
  const layoutById = new Map(layouts.map((l) => [l.id, l]))

  if (layouts.length === 0) {
    return (
      <StateScreen
        title="Not configured"
        description="Ice depth reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

  const lastSession = recentSessions[0] ?? null
  const recentList = recentSessions.slice(1, 4)

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: "var(--background)",
      }}
    >
      {/* Module header */}
      <div
        style={{
          padding: "20px 20px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: GREEN,
            }}
          >
            Ice Depth
          </div>
          <SyncChip />
        </div>
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "clamp(28px, 6vw, 40px)",
            lineHeight: 1,
            textTransform: "uppercase",
            color: "var(--foreground)",
            letterSpacing: "0.01em",
          }}
        >
          Select Layout
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            color: "var(--muted-foreground)",
          }}
        >
          Pick a rink layout to start recording measurements.
        </div>
      </div>

      {/* Last reading summary card */}
      {lastSession && (() => {
        const stats = statsFor(lastSession)
        const layout = layoutById.get(lastSession.layout_id)
        const emp = lastSession.employee_id
          ? employeeIndex.get(lastSession.employee_id)
          : null
        const submitter = emp ? nameFor(emp.first_name, emp.last_name) : "Unknown"
        return (
          <div style={{ padding: "16px 16px 0" }}>
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  flexShrink: 0,
                  background: `linear-gradient(135deg, ${NAVY}, ${GREEN})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.3 8.7L15.3 2.7a1 1 0 0 0-1.4 0L2.7 13.9a1 1 0 0 0 0 1.4l6 6a1 1 0 0 0 1.4 0L21.3 10.1a1 1 0 0 0 0-1.4z" />
                  <path d="m8 18-2-2" />
                  <path d="m12 14-2-2" />
                  <path d="m16 10-2-2" />
                  <path d="m10 16-2-2" />
                  <path d="m14 12-2-2" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--foreground)",
                    marginBottom: 2,
                  }}
                >
                  Last reading
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted-foreground)",
                    marginBottom: 10,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatStamp(lastSession.submitted_at, tz)} · {submitter}
                  {layout ? ` · ${layout.name}` : ""}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <ReadingPill kind="success">{stats.optimal} optimal</ReadingPill>
                  {stats.high > 0 && (
                    <ReadingPill kind="warn">{stats.high} thick</ReadingPill>
                  )}
                  {stats.low > 0 && (
                    <ReadingPill kind="error">{stats.low} below</ReadingPill>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Section label */}
      <div style={{ padding: "20px 20px 8px" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--muted-foreground)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Pick a layout
        </div>
      </div>

      {/* Layout cards */}
      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {layouts.map((layout) => (
          <Link
            key={layout.id}
            href={`/reports/ice-depth/${encodeURIComponent(layout.slug)}`}
            style={{ textDecoration: "none", display: "block" }}
            className="group"
          >
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                transition: "border-color 0.15s",
              }}
              className="group-hover:border-[#4DFF00]/40"
            >
              {/* Mini rink */}
              <div
                style={{
                  background: "var(--background)",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  overflow: "hidden",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 4,
                }}
              >
                <MiniRinkThumbnail points={layout.activePoints} />
              </div>

              {/* Layout info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: DISPLAY_FONT,
                    fontSize: 20,
                    lineHeight: 1.1,
                    textTransform: "uppercase",
                    color: "var(--foreground)",
                    letterSpacing: "0.01em",
                    marginBottom: 3,
                  }}
                >
                  {layout.name}
                </div>
                {layout.description && (
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 6 }}>
                    {layout.description}
                  </div>
                )}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 10px",
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    background: "var(--secondary)",
                    color: "var(--muted-foreground)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {layout.activePoints.length} point
                  {layout.activePoints.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Chevron */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--muted-foreground)", flexShrink: 0, transition: "color 0.15s" }}
                className="group-hover:text-[#4DFF00]"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      {recentList.length > 0 && (
        <div style={{ padding: "24px 16px 32px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--muted-foreground)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
              paddingLeft: 4,
            }}
          >
            Recent
          </div>
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            {recentList.map((s, i) => {
              const layout = layoutById.get(s.layout_id)
              const emp = s.employee_id ? employeeIndex.get(s.employee_id) : null
              const submitter = emp ? nameFor(emp.first_name, emp.last_name) : "Unknown"
              const inits = emp ? initialsFor(emp.first_name, emp.last_name) : "??"
              const stats = statsFor(s)
              let pillKind: "success" | "warn" | "error" = "success"
              let pillText = "Optimal"
              if (s.has_low_reading && stats.low > 0) {
                pillKind = "error"
                pillText = `${stats.low} below`
              } else if (s.has_high_reading && stats.high > 0) {
                pillKind = "warn"
                pillText = `${stats.high} thick`
              }
              return (
                <div
                  key={s.id}
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderBottom:
                      i < recentList.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9999,
                      background: "rgba(0,59,111,0.18)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#7AA9DC",
                      flexShrink: 0,
                    }}
                  >
                    {inits}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--foreground)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {layout?.name ?? "Unknown layout"}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {submitter} · {formatStamp(s.submitted_at, tz)}
                    </div>
                  </div>
                  <ReadingPill kind={pillKind}>{pillText}</ReadingPill>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Bottom spacer when recent list is hidden */}
      {recentList.length === 0 && <div style={{ height: 32 }} />}
    </div>
  )
}
