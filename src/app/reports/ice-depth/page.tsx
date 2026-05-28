import Link from "next/link"
import { redirect } from "next/navigation"

import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

export const dynamic = "force-dynamic"

type RinkRow = { id: string; name: string; slug: string; is_default: boolean }
type LayoutRow = {
  id: string
  name: string
  slug: string
  rink_id: string | null
  is_default: boolean
}

function StateScreen({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Breadcrumb
        segments={[
          { label: "Reports", href: "/reports" },
          { label: "Ice Depth" },
        ]}
      />
      <EmptyState
        title={title}
        description={description}
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        }
      />
    </div>
  )
}

function pickDiagram(layouts: LayoutRow[]): LayoutRow | null {
  return layouts.find((l) => l.is_default) ?? layouts[0] ?? null
}

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

  if (!(await currentUserCan(supabase, "ice_depth", "submit"))) {
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
