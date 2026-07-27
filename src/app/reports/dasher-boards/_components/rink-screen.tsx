import { redirect } from "next/navigation"
import { Fence } from "lucide-react"

import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import {
  getDueChecklist,
  getInspectionStatus,
  getRinkPerimeter,
} from "../_lib/queries"
import { ConditionMap } from "../[rinkSlug]/_components/condition-map"
import { RinkSwitcher } from "./rink-switcher"

// The single-screen Dasher Boards field tool, shared by the module landing
// (`/reports/dasher-boards`, which resolves the default rink) and the per-rink
// deep link (`/reports/dasher-boards/[rinkSlug]`). Opening the module lands
// directly on the condition map — no rink list, no walk gate.

export async function DasherBoardsRinkScreen({
  rinkSlug,
}: {
  /** null = resolve the default rink (is_default, else lowest sort_order). */
  rinkSlug: string | null
}) {
  const current = await requireUser()
  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "dasher_boards", "view"))) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <EmptyState
          icon={<Fence className="text-muted-foreground size-8" />}
          title="No access to Dasher Boards"
          description="Ask an administrator to grant you the Dasher Boards view permission."
        />
      </div>
    )
  }

  const { data: rinks } = await supabase
    .from("dasher_boards_rinks")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  // Empty-module state: admins go straight into the setup wizard; staff see a
  // not-yet-configured notice.
  if (!rinks || rinks.length === 0) {
    if (await currentUserCan(supabase, "dasher_boards", "admin")) {
      redirect("/admin/dasher-boards")
    }
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <EmptyState
          icon={<Fence className="text-muted-foreground size-8" />}
          title="Dasher Boards isn't set up yet"
          description="A facility manager needs to configure the rink perimeter before condition logging can start."
        />
      </div>
    )
  }

  const rink = rinkSlug
    ? (rinks.find((r) => r.slug === rinkSlug) ?? null)
    : (rinks.find((r) => r.is_default) ?? rinks[0])

  if (!rink) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <EmptyState
          icon={<Fence className="text-muted-foreground size-8" />}
          title="Rink not found"
          description="This rink doesn't exist or isn't configured yet."
        />
      </div>
    )
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  const [perimeter, due, status, canSubmit, canEdit, canAdmin] =
    await Promise.all([
      getRinkPerimeter(supabase, rink.id),
      getDueChecklist(supabase, rink.id),
      getInspectionStatus(supabase, rink.id),
      currentUserCan(supabase, "dasher_boards", "submit"),
      currentUserCan(supabase, "dasher_boards", "edit"),
      currentUserCan(supabase, "dasher_boards", "admin"),
    ])

  const [
    { data: openIssues },
    { data: categories },
    { data: doorSubtypes },
    { data: supervisorRows },
  ] = await Promise.all([
    supabase
      .from("dasher_boards_issues")
      .select("*")
      .eq("rink_id", rink.id)
      .is("resolved_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("dasher_boards_issue_categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("dasher_boards_asset_subtypes")
      .select("*")
      .eq("asset_type", "door")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    // Supervisor picker: the edit tier's role defaults are admin+manager.
    supabase
      .from("employees")
      .select("id, first_name, last_name, roles(key)")
      .eq("is_active", true)
      .order("first_name", { ascending: true }),
  ])

  const supervisors = (supervisorRows ?? [])
    .filter((e) => {
      const key = (e.roles as { key?: string } | null)?.key ?? ""
      return ["admin", "manager", "super_admin"].includes(key)
    })
    .map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim() }))

  // The caller's open walk on this rink (+ its responses and linked checklist
  // issues) so an in-progress walk resumes across page loads.
  let walk: { id: string; startedAt: string } | null = null
  let walkResponses: Record<string, "pass" | "flag"> = {}
  let walkIssueItemIds: string[] = []
  let walkAssetChecks: Record<
    string,
    { status: "pass" | "fail"; note: string | null }
  > = {}
  if (employee) {
    const { data: openWalk } = await supabase
      .from("dasher_boards_inspections")
      .select("id, started_at")
      .eq("rink_id", rink.id)
      .eq("inspector_id", employee.id)
      .is("completed_at", null)
      .maybeSingle()
    if (openWalk) {
      walk = { id: openWalk.id, startedAt: openWalk.started_at }
      const [{ data: responses }, { data: walkIssues }, { data: assetChecks }] =
        await Promise.all([
          supabase
            .from("dasher_boards_checklist_responses")
            .select("item_id, status")
            .eq("inspection_id", openWalk.id),
          supabase
            .from("dasher_boards_issues")
            .select("checklist_item_id")
            .eq("inspection_id", openWalk.id)
            .not("checklist_item_id", "is", null),
          supabase
            .from("dasher_boards_asset_checks")
            .select("asset_id, status, note")
            .eq("inspection_id", openWalk.id),
        ])
      walkResponses = Object.fromEntries(
        (responses ?? []).map((r) => [r.item_id, r.status as "pass" | "flag"]),
      )
      walkIssueItemIds = (walkIssues ?? [])
        .map((i) => i.checklist_item_id)
        .filter((v): v is string => !!v)
      walkAssetChecks = Object.fromEntries(
        (assetChecks ?? []).map((c) => [
          c.asset_id,
          { status: c.status as "pass" | "fail", note: c.note },
        ]),
      )
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        title={rink.name}
        eyebrow="Dasher Boards"
        actions={
          <RinkSwitcher
            rinks={rinks.map((r) => ({ slug: r.slug, name: r.name }))}
            currentSlug={rink.slug}
          />
        }
      />
      <ConditionMap
        rink={rink}
        assets={perimeter?.assets ?? []}
        openIssues={openIssues ?? []}
        categories={categories ?? []}
        doorSubtypes={doorSubtypes ?? []}
        supervisors={supervisors}
        due={due}
        status={status}
        walk={walk}
        walkResponses={walkResponses}
        walkIssueItemIds={walkIssueItemIds}
        walkAssetChecks={walkAssetChecks}
        employeeId={employee?.id ?? null}
        ownerId={current.authUser.id}
        can={{ submit: canSubmit, edit: canEdit, admin: canAdmin }}
      />
    </div>
  )
}
