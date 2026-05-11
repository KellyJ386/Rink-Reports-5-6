import Link from "next/link"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const DISPLAY_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

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
      {/* Ice surface — dark navy to match dark theme */}
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
      {/* Center red dashed line */}
      <line
        x1="62.5" y1="370" x2="317.5" y2="370"
        stroke="#cc0000" strokeWidth="7" strokeDasharray="20 16"
      />
      {/* Blue lines */}
      <line x1="62.5" y1="262" x2="317.5" y2="262" stroke="#0044aa" strokeWidth="7" />
      <line x1="62.5" y1="478" x2="317.5" y2="478" stroke="#0044aa" strokeWidth="7" />
      {/* Goal lines */}
      <line x1="80" y1="103" x2="300" y2="103" stroke="#cc0000" strokeWidth="4" />
      <line x1="80" y1="637" x2="300" y2="637" stroke="#cc0000" strokeWidth="4" />
      {/* Measurement point dots */}
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

  const { data: layoutsRaw } = await supabase
    .from("ice_depth_layouts")
    .select(
      "id, name, slug, description, sort_order, is_active, ice_depth_points(id, x_position, y_position, point_number, is_active)",
    )
    .eq("facility_id", employeeRow.facility_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  const layouts = (layoutsRaw ?? []).map((l) => ({
    ...l,
    activePoints: ((l.ice_depth_points as PointThumbnail[] | null) ?? []).filter(
      // @ts-expect-error is_active comes back from the nested query
      (p) => p.is_active !== false,
    ),
  }))

  if (layouts.length === 0) {
    return (
      <StateScreen
        title="Not configured"
        description="Ice depth reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

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
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#4DFF00",
            marginBottom: 4,
          }}
        >
          Ice Depth
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

      {/* Layout cards */}
      <div style={{ padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
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
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 10px",
                    borderRadius: 9999,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    background: "rgba(77,255,0,0.08)",
                    color: "#4DFF00",
                    border: "1px solid rgba(77,255,0,0.2)",
                  }}
                >
                  {layout.description ?? "Record depth measurements for this layout."}
                </div>
                {/* Point count badge */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                  {layout.activePoints.length} point{layout.activePoints.length !== 1 ? "s" : ""}
                </div>
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
    </div>
  )
}
