import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

// ── Mini rink thumbnail ───────────────────────────────────────────────────────
// Renders a small USA Hockey rink with measurement-point dots overlaid.
// Coordinates: x_position / y_position are 0..1 fractions → SVG px via
//   cx = x * 380, cy = y * 740  (same as the full USARink component).

type PointThumbnail = { x_position: number; y_position: number }

function MiniRinkThumbnail({ points }: { points: PointThumbnail[] }) {
  // ViewBox is 380×740; we display at 52×100 (scale ≈ 0.136)
  return (
    <svg
      viewBox="0 0 380 740"
      width="52"
      height="100"
      style={{
        display: "block",
        flexShrink: 0,
        borderRadius: 8,
        overflow: "hidden",
      }}
      aria-hidden
    >
      {/* Ice surface */}
      <rect
        x="62.5"
        y="70"
        width="255"
        height="600"
        rx="84"
        ry="84"
        fill="#e8f4f8"
        stroke="#333"
        strokeWidth="4"
      />
      {/* Center red dashed line */}
      <line
        x1="62.5"
        y1="370"
        x2="317.5"
        y2="370"
        stroke="#cc0000"
        strokeWidth="7"
        strokeDasharray="20 16"
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
          r="14"
          fill="#4DFF00"
          stroke="#003B6F"
          strokeWidth="3"
          opacity={0.9}
        />
      ))}
    </svg>
  )
}

// ── Not-available fallback ────────────────────────────────────────────────────

function NotAvailable({
  title,
  description,
  showSignOut = false,
}: {
  title: string
  description: string
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Ice Depth
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
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
      <NotAvailable
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
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
      <NotAvailable
        title="No permission"
        description="You don't have permission to submit ice depth reports."
      />
    )
  }

  // Fetch layouts with their active measurement points for mini thumbnails
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
      <NotAvailable
        title="Not configured yet"
        description="Ice depth reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

  const DISPLAY_FONT =
    "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      {/* Page header */}
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Ice Depth
        </p>
        <h1
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "clamp(30px, 5vw, 44px)",
            lineHeight: 1,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            color: "var(--foreground)",
            margin: "8px 0 4px",
          }}
        >
          Ice Depth
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick a layout to record measurements.
        </p>
      </div>

      {/* Layout cards */}
      <div className="flex flex-col gap-3">
        {layouts.map((layout) => (
          <Link
            key={layout.id}
            href={`/reports/ice-depth/${encodeURIComponent(layout.slug)}`}
            className="group rounded-2xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: 16,
                transition: "border-color 0.15s, box-shadow 0.15s",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
              className="group-hover:border-[#4DFF00]/40 group-hover:shadow-md"
            >
              {/* Mini rink thumbnail */}
              <div
                style={{
                  background: "#e8f4f8",
                  borderRadius: 10,
                  overflow: "hidden",
                  flexShrink: 0,
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MiniRinkThumbnail points={layout.activePoints} />
              </div>

              {/* Layout info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: DISPLAY_FONT,
                    fontSize: 22,
                    lineHeight: 1,
                    letterSpacing: "0.01em",
                    textTransform: "uppercase",
                    color: "var(--foreground)",
                    marginBottom: 4,
                  }}
                >
                  {layout.name}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--muted-foreground)",
                    marginBottom: 8,
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
                      background: "rgba(0,59,111,0.08)",
                      color: "#003B6F",
                      border: "1px solid rgba(0,59,111,0.18)",
                    }}
                  >
                    {layout.activePoints.length} point
                    {layout.activePoints.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  color: "var(--muted-foreground)",
                  flexShrink: 0,
                  transition: "color 0.15s, transform 0.15s",
                }}
                className="group-hover:text-foreground group-hover:translate-x-0.5"
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
