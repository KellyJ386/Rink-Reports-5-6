import Link from "next/link"
import { Check, ChevronLeft, Download, Fence } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { RinkPerimeter } from "@/components/rink/rink-perimeter"
import type { PerimeterCondition } from "@/components/rink/rink-perimeter"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import {
  combineAssetAndChildCheckStatus,
  combineDisplayCondition,
  isUuid,
  worstOpenSeverity,
  type AssetCheckStatus,
  type IssueSeverity,
} from "../../_lib/compute"
import { PrintWalkButton } from "./_components/print-walk-button"
import { SendReportButton } from "./_components/send-report-button"

export const dynamic = "force-dynamic"
export const metadata = { title: "Walk Complete | Rink Reports" }

const DISPLAY_FONT =
  "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  a: "A — Safety critical",
  b: "B — Needs repair",
  c: "C — Cosmetic",
}

// Per-severity Tailwind classes for badges + pills (semantic tokens so the
// page adapts to light/dark).
const SEVERITY_BADGE_CLASS: Record<IssueSeverity, string> = {
  a: "text-destructive border-destructive/30 bg-destructive/10",
  b: "text-warning border-warning/30 bg-warning/10",
  c: "text-warning border-warning/30 bg-warning/10",
}

function formatTimestamp(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

function NotFound({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <EmptyState
        icon={<Fence className="text-muted-foreground size-8" />}
        title={title}
        description={description}
        action={
          <Button asChild variant="outline">
            <Link href="/reports/dasher-boards">Back to Dasher Boards</Link>
          </Button>
        }
      />
    </div>
  )
}

export default async function DasherBoardsDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ rinkSlug: string }>
  searchParams: Promise<{ id?: string | string[] }>
}) {
  await requireUser()
  const supabase = await createClient()
  const [{ rinkSlug }, sp] = await Promise.all([params, searchParams])
  const idParam = Array.isArray(sp.id) ? sp.id[0] : sp.id

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

  if (!idParam || !isUuid(idParam)) {
    return (
      <NotFound
        title="Walk not found"
        description="This link is missing a valid walk id."
      />
    )
  }

  const [{ data: rink }, { data: inspection }] = await Promise.all([
    supabase
      .from("dasher_boards_rinks")
      .select("*")
      .eq("slug", rinkSlug)
      .eq("is_active", true)
      .maybeSingle(),
    // RLS scopes the read to the caller's facility.
    supabase
      .from("dasher_boards_inspections")
      .select("id, rink_id, facility_id, inspector_id, started_at, completed_at, notes")
      .eq("id", idParam)
      .maybeSingle(),
  ])

  if (!rink) {
    return (
      <NotFound
        title="Rink not found"
        description="This rink doesn't exist or isn't configured yet."
      />
    )
  }
  if (!inspection || inspection.rink_id !== rink.id) {
    return (
      <NotFound
        title="Walk not found"
        description="This walk doesn't exist on this rink, or you don't have access to it."
      />
    )
  }
  if (!inspection.completed_at) {
    return (
      <NotFound
        title="Walk not signed off yet"
        description="This walk is still in progress. Sign it off from the rink page to generate its report."
      />
    )
  }

  const [
    { data: assets },
    { data: checks },
    { data: issues },
    { data: responses },
    { data: facility },
  ] = await Promise.all([
    supabase
      .from("dasher_boards_assets")
      .select("id, label, asset_type, parent_board_id, sequence_position, is_active")
      .eq("rink_id", rink.id)
      .order("sequence_position", { ascending: true, nullsFirst: false })
      .order("label", { ascending: true }),
    supabase
      .from("dasher_boards_asset_checks")
      .select("asset_id, status, note")
      .eq("inspection_id", inspection.id),
    supabase
      .from("dasher_boards_issues")
      .select(
        "id, asset_id, checklist_item_id, description, severity, action_taken, supervisor_ack_at, resolved_at, created_at",
      )
      .eq("inspection_id", inspection.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("dasher_boards_checklist_responses")
      .select("item_id, status")
      .eq("inspection_id", inspection.id),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", inspection.facility_id)
      .maybeSingle(),
  ])

  // Inspector name + checklist item labels (small follow-up lookups).
  let inspectorName: string | null = null
  if (inspection.inspector_id) {
    const { data: emp } = await supabase
      .from("employees")
      .select("first_name, last_name")
      .eq("id", inspection.inspector_id)
      .maybeSingle()
    if (emp) inspectorName = `${emp.first_name} ${emp.last_name}`.trim()
  }

  const responseItemIds = (responses ?? []).map((r) => r.item_id)
  let itemLabels = new Map<string, string>()
  if (responseItemIds.length > 0) {
    const { data: items } = await supabase
      .from("dasher_boards_checklist_items")
      .select("id, label")
      .in("id", responseItemIds)
    itemLabels = new Map((items ?? []).map((i) => [i.id, i.label]))
  }

  const tz = facility?.timezone ?? null
  const allAssets = assets ?? []
  const assetById = new Map(allAssets.map((a) => [a.id, a]))

  // Glass rows have no diagram segment of their own — their walk condition
  // rides on the parent board's segment (same attribution rule as the live
  // condition map in _lib/queries.ts).
  const glassParent = new Map<string, string>() // glassId -> boardId
  const glassChildOf = new Map<string, string>() // boardId -> glassId
  for (const a of allAssets) {
    if (a.asset_type === "glass_panel" && a.parent_board_id) {
      glassParent.set(a.id, a.parent_board_id)
      glassChildOf.set(a.parent_board_id, a.id)
    }
  }

  // WALK-SCOPED condition per asset: only this walk's checks and this walk's
  // still-open issues color the report diagram (not the rink's full history).
  const sevRollup = new Map<string, IssueSeverity[]>()
  const pushSev = (assetId: string, severity: IssueSeverity) => {
    const list = sevRollup.get(assetId) ?? []
    list.push(severity)
    sevRollup.set(assetId, list)
  }
  for (const issue of issues ?? []) {
    if (!issue.asset_id || issue.resolved_at) continue
    pushSev(issue.asset_id, issue.severity as IssueSeverity)
    const parentId = glassParent.get(issue.asset_id)
    if (parentId) pushSev(parentId, issue.severity as IssueSeverity)
  }

  // One check per asset per walk (unique on inspection_id + asset_id).
  const ownCheck = new Map<string, AssetCheckStatus>()
  for (const c of checks ?? []) {
    ownCheck.set(c.asset_id, c.status as AssetCheckStatus)
  }

  const conditionByAssetId: Record<string, PerimeterCondition> = {}
  for (const a of allAssets) {
    if (a.asset_type === "glass_panel") continue
    const childId = glassChildOf.get(a.id)
    const combinedCheck = childId
      ? combineAssetAndChildCheckStatus(
          ownCheck.get(a.id) ?? null,
          ownCheck.get(childId) ?? null,
        )
      : (ownCheck.get(a.id) ?? null)
    const condition = combineDisplayCondition({
      worstOpenSeverity: worstOpenSeverity(sevRollup.get(a.id) ?? []),
      latestCheckStatus: combinedCheck,
    })
    if (condition) conditionByAssetId[a.id] = condition
  }

  const positioned = allAssets
    .filter(
      (a) =>
        (a.asset_type === "board_panel" || a.asset_type === "door") &&
        a.is_active &&
        a.sequence_position !== null,
    )
    .sort((a, b) => a.sequence_position! - b.sequence_position!)
    .map((a) => ({
      id: a.id,
      label: a.label,
      asset_type: a.asset_type as "board_panel" | "door",
    }))

  const walkChecks = checks ?? []
  const failChecks = walkChecks.filter((c) => c.status === "fail")
  const passChecks = walkChecks.filter((c) => c.status === "pass")
  // Notable checks worth listing: every fail, plus any pass that carries a note.
  const notableChecks = [
    ...failChecks,
    ...passChecks.filter((c) => c.note && c.note.trim().length > 0),
  ]
  const walkIssues = issues ?? []
  const checklist = responses ?? []

  const assetLabel = (assetId: string | null): string => {
    if (!assetId) return "—"
    const a = assetById.get(assetId)
    if (!a) return "—"
    const kind =
      a.asset_type === "door"
        ? "Door"
        : a.asset_type === "glass_panel"
          ? "Glass"
          : "Board"
    return `${kind} ${a.label}`
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      {/* Print: app chrome, hero and action buttons drop out; the diagram and
          summary sections print as a clean one-report flow. */}
      <style>{`@media print {
        aside, header, nav, footer { display: none !important; }
        #main-content { padding-bottom: 0 !important; }
        #main-content, #main-content * { box-shadow: none !important; }
        .db-print-hide { display: none !important; }
        .db-print-area { padding: 0 !important; }
        .db-print-diagram { max-width: 4.6in !important; margin: 0 auto !important; page-break-inside: avoid; break-inside: avoid; }
        .db-print-diagram svg { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .db-print-section { page-break-inside: avoid; break-inside: avoid; border-color: #ccc !important; }
        @page { size: letter portrait; margin: 0.5in; }
      }`}</style>

      {/* Back to the rink map — hidden in print output. */}
      <div className="db-print-hide px-4 pt-4">
        <Button
          asChild
          variant="outline"
          size="lg"
          className="min-h-11 text-sm font-semibold text-muted-foreground"
        >
          <Link href={`/reports/dasher-boards/${rink.slug}`}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Back to Rink
          </Link>
        </Button>
      </div>

      {/* Print-only caption (rink name + sign-off time) above the diagram. */}
      <div className="hidden text-center print:block">
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "24px",
            textTransform: "uppercase",
            color: "#000",
            lineHeight: 1,
          }}
        >
          {rink.name} — Dasher Boards Walk
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {inspectorName ? `${inspectorName} · ` : ""}
          {formatTimestamp(inspection.completed_at, tz)}
        </div>
      </div>

      {/* Hero — success checkmark + submitted badge */}
      <div className="db-print-hide flex flex-col items-center gap-[14px] border-b border-border px-5 pb-7 pt-10 text-center">
        <div
          aria-hidden
          className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-success bg-success/10"
          style={{
            boxShadow:
              "0 0 32px color-mix(in srgb, var(--success) 20%, transparent)",
          }}
        >
          <Check className="h-10 w-10 text-success" strokeWidth={3} />
        </div>

        <div className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-4 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-success">
          Walk signed off
        </div>

        <div>
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: "clamp(26px, 6vw, 36px)",
              textTransform: "uppercase",
              color: "var(--foreground)",
              lineHeight: 1,
              letterSpacing: "0.01em",
            }}
          >
            {rink.name}
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {inspectorName ? `${inspectorName} · ` : ""}
            Started {formatTimestamp(inspection.started_at, tz)} · Signed off{" "}
            {formatTimestamp(inspection.completed_at, tz)}
          </div>
        </div>

        {/* Stats pills */}
        <div className="flex flex-wrap justify-center gap-2">
          <StatPill
            label="Pass"
            value={passChecks.length}
            className={
              passChecks.length > 0
                ? "text-success border-success/30 bg-success/10"
                : undefined
            }
          />
          <StatPill
            label="Fail"
            value={failChecks.length}
            className={
              failChecks.length > 0
                ? "text-destructive border-destructive/30 bg-destructive/10"
                : undefined
            }
          />
          <StatPill
            label="Issues"
            value={walkIssues.length}
            className={
              walkIssues.length > 0
                ? "text-warning border-warning/30 bg-warning/10"
                : undefined
            }
          />
          <StatPill label="Checklist" value={checklist.length} />
        </div>
      </div>

      <div className="db-print-area mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5">
        {/* Read-only perimeter diagram with the walk's final condition colors. */}
        {positioned.length > 0 && (
          <div className="db-print-diagram mx-auto w-full max-w-[300px] rounded-xl border border-border bg-card p-2">
            <RinkPerimeter
              className="w-full"
              positioned={positioned}
              direction={
                rink.perimeter_direction as "clockwise" | "counterclockwise"
              }
              anchorOffsetFraction={rink.perimeter_anchor_offset}
              conditionByAssetId={conditionByAssetId}
            />
            <p className="mb-1 mt-2 text-center text-[11px] text-muted-foreground">
              Red = open severity A · yellow = open B/C · coral = flagged fail ·
              untapped assets attested OK at sign-off
            </p>
          </div>
        )}

        {/* Failed / flagged asset checks (plus passes that carry a note). */}
        {notableChecks.length > 0 && (
          <div className="db-print-section rounded-xl border border-border bg-card px-4 py-[14px]">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Condition Checks
            </div>
            <div className="flex flex-col gap-2 text-[13px]">
              {notableChecks.map((c) => (
                <p key={c.asset_id} className="m-0">
                  <span className="font-semibold text-foreground">
                    {assetLabel(c.asset_id)}:{" "}
                  </span>
                  <span
                    className={
                      c.status === "pass" ? "text-success" : "text-destructive"
                    }
                  >
                    {c.status === "pass" ? "Pass" : "Fail"}
                  </span>
                  {c.note && <span className="text-foreground"> — {c.note}</span>}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Issues logged during the walk. */}
        {walkIssues.length > 0 && (
          <div className="db-print-section rounded-xl border border-border bg-card px-4 py-[14px]">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Issues Reported
            </div>
            <div className="flex flex-col gap-3">
              {walkIssues.map((issue) => {
                const severity = issue.severity as IssueSeverity
                return (
                  <div key={issue.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${SEVERITY_BADGE_CLASS[severity]}`}
                      >
                        {SEVERITY_LABEL[severity]}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {issue.checklist_item_id
                          ? (itemLabels.get(issue.checklist_item_id) ??
                            "Checklist item")
                          : assetLabel(issue.asset_id)}
                      </span>
                      {issue.resolved_at && (
                        <span className="text-[11px] font-semibold text-success">
                          Resolved
                        </span>
                      )}
                      {severity === "a" && issue.supervisor_ack_at && (
                        <span className="text-[11px] text-muted-foreground">
                          Supervisor acknowledged
                        </span>
                      )}
                    </div>
                    <p className="m-0 text-[13px] text-foreground">
                      {issue.description}
                    </p>
                    {issue.action_taken && (
                      <p className="m-0 text-xs text-muted-foreground">
                        Action taken: {issue.action_taken}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Checklist answers. */}
        {checklist.length > 0 && (
          <div className="db-print-section rounded-xl border border-border bg-card px-4 py-[14px]">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Checklist
            </div>
            <div className="flex flex-col gap-2 text-[13px]">
              {checklist.map((r) => (
                <p key={r.item_id} className="m-0">
                  <span className="font-semibold text-foreground">
                    {itemLabels.get(r.item_id) ?? "Checklist item"}:{" "}
                  </span>
                  <span
                    className={
                      r.status === "pass" ? "text-success" : "text-warning"
                    }
                  >
                    {r.status === "pass" ? "Pass" : "Flagged"}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Walk notes. */}
        {inspection.notes && (
          <div className="db-print-section rounded-xl border border-border bg-card px-4 py-[14px]">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Notes
            </div>
            <p className="m-0 whitespace-pre-wrap text-[13px] text-foreground">
              {inspection.notes}
            </p>
          </div>
        )}

        {/* CTAs */}
        <div className="db-print-hide flex flex-col gap-[10px] pb-4">
          <Button
            asChild
            variant="outline"
            size="lg"
            className="min-h-11 w-full text-sm font-semibold text-muted-foreground"
          >
            <a
              href={`/reports/dasher-boards/${rink.slug}/done/pdf?id=${inspection.id}`}
              download
            >
              <Download className="h-4 w-4" aria-hidden />
              Download PDF
            </a>
          </Button>
          <PrintWalkButton />
          <SendReportButton inspectionId={inspection.id} />
          <Button
            asChild
            size="lg"
            className="min-h-[52px] w-full text-lg uppercase tracking-[0.02em]"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            <Link href="/reports/dasher-boards">Back to Dasher Boards</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="min-h-11 w-full text-sm font-semibold text-muted-foreground"
          >
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatPill({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className?: string
}) {
  return (
    <div
      className={`inline-flex items-center gap-[5px] rounded-full border px-3 py-1 ${
        className ?? "text-muted-foreground border-border bg-muted/40"
      }`}
    >
      <span
        className="text-sm font-bold"
        style={{ fontFamily: "var(--font-geist-mono), monospace" }}
      >
        {value}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.06em] opacity-80">
        {label}
      </span>
    </div>
  )
}
