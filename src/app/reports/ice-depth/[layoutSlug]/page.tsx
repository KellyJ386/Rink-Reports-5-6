import Link from "next/link"
import { notFound } from "next/navigation"

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

import { SubmissionForm } from "../_components/submission-form"
import type { LayoutForForm, PointForForm, SettingsForForm } from "../types"

type RouteParams = {
  layoutSlug: string
}

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
          /{" "}
          <Link href="/reports/ice-depth" className="hover:underline">
            Ice Depth
          </Link>
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

  const { data: layout } = await supabase
    .from("ice_depth_layouts")
    .select("id, name, slug, diagram_aspect_ratio, is_active")
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
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          /{" "}
          <Link href="/reports/ice-depth" className="hover:underline">
            Ice Depth
          </Link>{" "}
          / {layout.name}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {layout.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap a point on the diagram, type a depth, and press Enter to advance.
          You can submit even if some points are blank.
        </p>
      </div>

      <SubmissionForm
        layout={layoutForForm}
        points={points}
        settings={settings}
      />
    </div>
  )
}
