import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"

import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { getRinkOverlays } from "@/lib/ice-depth/overlays"
import { currentUserCan } from "@/lib/permissions/check"

import { DiagramNav } from "../_components/diagram-nav"
import { SubmissionForm } from "../_components/submission-form"
import { SyncChip } from "../_components/sync-chip"
import type { LayoutForForm, PointForForm, SettingsForForm } from "../types"

export const dynamic = "force-dynamic"

type RouteParams = {
  layoutSlug: string
}

function NotAvailable({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Breadcrumb
        segments={[
          { label: "Reports", href: "/reports" },
          { label: "Ice Depth", href: "/reports/ice-depth" },
        ]}
      />
      <EmptyState
        title={title}
        description={description}
        action={
          <Button asChild variant="outline">
            <Link href="/reports/ice-depth">Back to Ice Depth</Link>
          </Button>
        }
      />
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

  if (!(await currentUserCan(supabase, "ice_depth", "submit"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to submit ice depth reports."
      />
    )
  }

  const { data: layout } = await supabase
    .from("ice_depth_layouts")
    .select("id, name, slug, diagram_aspect_ratio, is_active, logo_url, rink_id")
    .eq("facility_id", employeeRow.facility_id)
    .eq("slug", layoutSlug)
    .maybeSingle()

  if (!layout || !layout.is_active) {
    notFound()
  }

  const [
    { data: pointsRaw },
    { data: settingsRaw },
    { data: rinksRaw },
    { data: siblingsRaw },
    overlays,
  ] = await Promise.all([
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
      supabase
        .from("ice_depth_rinks")
        .select("id, name")
        .eq("facility_id", employeeRow.facility_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("ice_depth_layouts")
        .select("name, slug, rink_id, is_default, sort_order")
        .eq("facility_id", employeeRow.facility_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      // Facility-level diagram overlays (door markers + logo watermark) —
      // read-only reference geography, identical on every report.
      getRinkOverlays(supabase, employeeRow.facility_id),
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

  // Cascading nav data: each rink resolves to its default-or-first diagram, and
  // the diagram dropdown lists the active diagrams on the current rink.
  type Sibling = {
    name: string
    slug: string
    rink_id: string | null
    is_default: boolean
  }
  const siblings = (siblingsRaw ?? []) as Sibling[]
  const rinkOptions = ((rinksRaw ?? []) as Array<{ id: string; name: string }>).map(
    (r) => {
      const diagrams = siblings.filter((s) => s.rink_id === r.id)
      const target = diagrams.find((d) => d.is_default) ?? diagrams[0] ?? null
      return { id: r.id, name: r.name, targetSlug: target?.slug ?? null }
    },
  )
  const diagramOptions = siblings
    .filter((s) => s.rink_id === layout.rink_id)
    .map((s) => ({ slug: s.slug, name: s.name }))
  const showNav = rinkOptions.length > 1 || diagramOptions.length > 1

  return (
    <div className="flex min-h-full flex-col bg-background">
      {/* Module header */}
      <div
        className="flex items-center gap-3 border-b border-l-4 border-border border-l-module-ice-depth px-4 pt-4 pb-3"
        style={{
          ["--module-accent" as string]: "var(--module-ice-depth)",
          backgroundImage:
            "linear-gradient(120deg, color-mix(in oklab, var(--module-accent) 14%, transparent) 0%, transparent 70%)",
        }}
      >
        <Button
          asChild
          variant="outline"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          aria-label="Back to layouts"
        >
          <Link href="/reports/ice-depth">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0">
          <div className="mb-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-module-ice-depth">
            Ice Depth
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[clamp(20px,5vw,28px)] uppercase leading-none tracking-[0.01em] text-foreground">
            {layout.name}
          </div>
        </div>
        <div className="ml-auto shrink-0">
          <SyncChip />
        </div>
      </div>

      {/* Rink + diagram pickers */}
      {showNav && (
        <DiagramNav
          rinks={rinkOptions}
          currentRinkId={layout.rink_id}
          diagrams={diagramOptions}
          currentSlug={layout.slug}
        />
      )}

      {/* Form */}
      <div className="px-3 pt-3 pb-6">
        <SubmissionForm
          layout={layoutForForm}
          points={points}
          settings={settings}
          overlays={overlays}
        />
      </div>
    </div>
  )
}
