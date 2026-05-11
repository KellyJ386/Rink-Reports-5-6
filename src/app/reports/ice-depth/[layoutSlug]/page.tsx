import Link from "next/link"
import { notFound } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { SubmissionForm } from "../_components/submission-form"
import type { LayoutForForm, PointForForm, SettingsForForm } from "../types"

export const dynamic = "force-dynamic"

type RouteParams = {
  layoutSlug: string
}

const SCREEN_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

function NotAvailable({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        style={{
          fontFamily: SCREEN_FONT,
          fontSize: "clamp(20px, 5vw, 28px)",
          textTransform: "uppercase",
          color: "var(--foreground)",
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      <p style={{ fontSize: 14, color: "var(--muted-foreground)", maxWidth: 300 }}>
        {description}
      </p>
      <Link
        href="/reports/ice-depth"
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
        Back to Ice Depth
      </Link>
    </div>
  )
}

export default async function IceDepthLayoutSubmissionPage({
  params,
}: {
  params: Promise<RouteParams>
}) {
  const { layoutSlug } = await params
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

  const { data: layout } = await supabase
    .from("ice_depth_layouts")
    .select("id, name, slug, diagram_aspect_ratio, is_active, logo_url")
    .eq("facility_id", employeeRow.facility_id)
    .eq("slug", layoutSlug)
    .maybeSingle()

  if (!layout || !layout.is_active) {
    notFound()
  }

  const [{ data: pointsRaw }, { data: settingsRaw }] = await Promise.all([
    supabase
      .from("ice_depth_points")
      .select(
        "id, point_number, label, x_position, y_position, sort_order, is_active"
      )
      .eq("layout_id", layout.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("point_number", { ascending: true }),
    supabase
      .from("ice_depth_settings")
      .select("measurement_unit, low_threshold, high_threshold")
      .eq("facility_id", employeeRow.facility_id)
      .maybeSingle(),
  ])

  const points: PointForForm[] = (pointsRaw ?? []).map((p) => ({
    id: p.id,
    point_number: p.point_number,
    label: p.label,
    x_position: p.x_position,
    y_position: p.y_position,
    sort_order: p.sort_order,
  }))

  if (points.length === 0) {
    return (
      <NotAvailable
        title="No points configured"
        description="This layout has no points configured yet. Talk to your administrator."
      />
    )
  }

  const settings: SettingsForForm = {
    measurement_unit: settingsRaw?.measurement_unit ?? "inches",
    low_threshold:
      typeof settingsRaw?.low_threshold === "number"
        ? settingsRaw.low_threshold
        : 1,
    high_threshold:
      typeof settingsRaw?.high_threshold === "number"
        ? settingsRaw.high_threshold
        : 1.5,
  }

  const layoutForForm: LayoutForForm = {
    id: layout.id,
    name: layout.name,
    slug: layout.slug,
    diagram_aspect_ratio: layout.diagram_aspect_ratio,
    logo_url: layout.logo_url ?? null,
  }

  const DISPLAY_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

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
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link
          href="/reports/ice-depth"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9999,
            border: "1px solid var(--border)",
            background: "var(--card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "var(--muted-foreground)",
            textDecoration: "none",
          }}
          aria-label="Back to layouts"
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#4DFF00",
              marginBottom: 2,
            }}
          >
            Ice Depth
          </div>
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: "clamp(20px, 5vw, 28px)",
              lineHeight: 1,
              textTransform: "uppercase",
              color: "var(--foreground)",
              letterSpacing: "0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {layout.name}
          </div>
        </div>
      </div>

      {/* Form */}
      <div style={{ padding: "12px 12px 24px" }}>
        <SubmissionForm
          layout={layoutForForm}
          points={points}
          settings={settings}
        />
      </div>
    </div>
  )
}
