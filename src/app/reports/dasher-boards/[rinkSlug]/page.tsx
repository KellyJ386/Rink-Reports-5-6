import Link from "next/link"
import { Fence } from "lucide-react"

import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { getDueChecklist, getRinkPerimeter } from "../_lib/queries"
import { ConditionMap } from "./_components/condition-map"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dasher Boards | Rink Reports" }

export default async function DasherBoardsRinkPage({
  params,
}: {
  params: Promise<{ rinkSlug: string }>
}) {
  const current = await requireUser()
  const supabase = await createClient()
  const { rinkSlug } = await params

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

  const { data: rink } = await supabase
    .from("dasher_boards_rinks")
    .select("*")
    .eq("slug", rinkSlug)
    .eq("is_active", true)
    .maybeSingle()

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

  const [perimeter, due, canSubmit, canEdit, canAdmin] = await Promise.all([
    getRinkPerimeter(supabase, rink.id),
    getDueChecklist(supabase, rink.id),
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
  // issues) so the walk flow resumes across page loads.
  let walk: { id: string; startedAt: string } | null = null
  let walkResponses: Record<string, "pass" | "flag"> = {}
  let walkIssueItemIds: string[] = []
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
      const [{ data: responses }, { data: walkIssues }] = await Promise.all([
        supabase
          .from("dasher_boards_checklist_responses")
          .select("item_id, status")
          .eq("inspection_id", openWalk.id),
        supabase
          .from("dasher_boards_issues")
          .select("checklist_item_id")
          .eq("inspection_id", openWalk.id)
          .not("checklist_item_id", "is", null),
      ])
      walkResponses = Object.fromEntries(
        (responses ?? []).map((r) => [r.item_id, r.status as "pass" | "flag"]),
      )
      walkIssueItemIds = (walkIssues ?? [])
        .map((i) => i.checklist_item_id)
        .filter((v): v is string => !!v)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        title={rink.name}
        eyebrow="Dasher Boards"
        breadcrumb={
          <Link
            href="/reports/dasher-boards"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            ← Dasher Boards
          </Link>
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
        walk={walk}
        walkResponses={walkResponses}
        walkIssueItemIds={walkIssueItemIds}
        employeeId={employee?.id ?? null}
        ownerId={current.authUser.id}
        can={{ submit: canSubmit, edit: canEdit, admin: canAdmin }}
      />
    </div>
  )
}
