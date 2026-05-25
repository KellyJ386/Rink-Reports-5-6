import Link from "next/link"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const DISPLAY_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

type RinkRow = { id: string; name: string; slug: string; is_default: boolean }
type LayoutRow = {
  id: string
  name: string
  slug: string
  rink_id: string | null
  is_default: boolean
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

// Pick a rink's default diagram, falling back to its first active diagram.
function pickDiagram(layouts: LayoutRow[]): LayoutRow | null {
  return layouts.find((l) => l.is_default) ?? layouts[0] ?? null
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

  const [rinksRes, layoutsRes] = await Promise.all([
    supabase
      .from("ice_depth_rinks")
      .select("id, name, slug, is_default")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_depth_layouts")
      .select("id, name, slug, rink_id, is_default")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ])

  const rinks = (rinksRes.data ?? []) as RinkRow[]
  const layouts = (layoutsRes.data ?? []) as LayoutRow[]

  if (rinks.length === 0 || layouts.length === 0) {
    return (
      <StateScreen
        title="Not configured"
        description="Ice depth reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

  // Resolve the default rink (flagged, else first active), then walk rinks in
  // order so we land on the first one that actually has a diagram.
  const orderedRinks = [
    ...rinks.filter((r) => r.is_default),
    ...rinks.filter((r) => !r.is_default),
  ]
  for (const rink of orderedRinks) {
    const target = pickDiagram(layouts.filter((l) => l.rink_id === rink.id))
    if (target) {
      redirect(`/reports/ice-depth/${encodeURIComponent(target.slug)}`)
    }
  }

  return (
    <StateScreen
      title="No diagrams"
      description="No measurement diagrams are configured for your rinks yet. Talk to your administrator."
    />
  )
}
