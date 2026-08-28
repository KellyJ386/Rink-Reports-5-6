"use client"

// The tap-to-log bottom sheet for one perimeter asset: pass/fail condition
// check (during a walk), the report-issue form (the default, walk-or-no-walk
// logging path), open issues with acknowledge/resolve, the read-only
// replacement spec, and collapsed history.
//
// Asset EDITING (door conversion, glass-spec entry) is deliberately absent:
// those are admin operations that live in the admin perimeter editor
// (/admin/dasher-boards) behind the dasher_boards admin/edit grants — this is
// a staff-facing field surface.

import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { LocalDateTime } from "@/components/app/local-datetime"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

import { getAssetDetailAction } from "../../actions"
import { thicknessToFraction } from "../../_lib/compute"
import type { AssetDetail, IssueRow, PerimeterAsset } from "../../_lib/queries"
import { OpenIssueRow, ReportIssueForm } from "./issue-form"
import type { Tables } from "@/types/database"
import { glassLabelOf } from "../../_lib/glass-numbering"
import { resolveSegmentLabel } from "../../_lib/display-label"

type SubtypeRow = Tables<"dasher_boards_asset_subtypes">
type CategoryRow = Tables<"dasher_boards_issue_categories">

export function AssetSheet({
  asset,
  assets,
  glassNumbers,
  openIssues,
  categories,
  doorSubtypes,
  supervisors,
  can,
  online,
  walkActive,
  assetChecks,
  checkPending,
  onSaveCheck,
  onIssueReported,
  onClose,
}: {
  /** null = closed. */
  asset: PerimeterAsset | null
  assets: PerimeterAsset[]
  /** The rink's glass numbers; empty = show the permanent labels. */
  glassNumbers: Record<string, string>
  openIssues: IssueRow[]
  categories: CategoryRow[]
  doorSubtypes: SubtypeRow[]
  supervisors: Array<{ id: string; name: string }>
  can: { submit: boolean; edit: boolean; admin: boolean }
  online: boolean
  walkActive: boolean
  assetChecks: Record<string, { status: "pass" | "fail"; note: string | null }>
  checkPending: boolean
  onSaveCheck: (assetId: string, status: "pass" | "fail", note: string | null) => void
  onIssueReported: (checklistItemId: string | null) => void
  onClose: () => void
}) {
  const glassChild =
    asset && asset.asset_type === "board_panel"
      ? (assets.find(
          (a) => a.asset_type === "glass_panel" && a.parent_board_id === asset.id,
        ) ?? null)
      : null
  const specTarget = asset
    ? asset.asset_type === "door"
      ? asset
      : glassChild && glassChild.is_active
        ? glassChild
        : null
    : null
  const subtypeLabel = asset?.subtype_id
    ? (doorSubtypes.find((s) => s.id === asset.subtype_id)?.label ?? null)
    : null
  const issuesHere = asset
    ? openIssues.filter(
        (i) => i.asset_id === asset.id || i.asset_id === glassChild?.id,
      )
    : []

  // custom_label > glass number > the permanent `label` — the same
  // resolution the diagram itself prints (resolveSegmentLabel), so the sheet
  // and the diagram always agree on what a segment is called.
  const labelInfo = asset ? resolveSegmentLabel(asset, glassNumbers) : null

  // Zone name + full history (with label_snapshot) aren't on the `asset`
  // prop — zone_id has no name attached, and only open issues are passed
  // down from the condition map. Loaded once per asset open, online only
  // (same offline limitation the old lazy history load had).
  // Keyed by asset id so a stale fetch can never paint another segment's
  // detail, and so loading/reset are DERIVED (no setState inside the effect
  // body — only in the async continuation).
  const [loaded, setLoaded] = useState<{
    assetId: string
    detail: AssetDetail | null
  } | null>(null)
  const assetId = asset?.id ?? null
  useEffect(() => {
    if (!assetId || !online) return
    let cancelled = false
    void getAssetDetailAction(assetId).then((r) => {
      if (cancelled) return
      setLoaded({ assetId, detail: r.ok ? r.detail : null })
    })
    return () => {
      cancelled = true
    }
  }, [assetId, online])
  const detail = loaded?.assetId === assetId ? loaded.detail : null
  const detailLoading =
    online && assetId !== null && loaded?.assetId !== assetId

  return (
    <Sheet open={asset !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-xl px-4 pb-8"
      >
        {asset && labelInfo && (
          <>
            <SheetHeader className="px-0">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {/* Resolved display label prominently; the permanent
                    identity alongside in parens whenever they diverge, so a
                    renamed segment stays traceable to its issue history. */}
                <span className="font-mono">{labelInfo.display}</span>
                {labelInfo.display !== labelInfo.identity && (
                  <span className="text-muted-foreground font-mono text-sm">
                    ({labelInfo.identity})
                  </span>
                )}
                <Badge variant={asset.asset_type === "door" ? "special" : "secondary"}>
                  {asset.asset_type === "door"
                    ? (subtypeLabel ?? "Door")
                    : asset.asset_type === "glass_panel"
                      ? "Glass"
                      : "Board panel"}
                </Badge>
                {asset.out_of_service && (
                  <Badge variant="warning">Out of service</Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                {asset.open_count > 0
                  ? `${asset.open_count} open issue(s) on this asset.`
                  : "No open issues."}
                {detail?.zoneName ? ` · Zone: ${detail.zoneName}` : ""}
              </SheetDescription>
            </SheetHeader>

            {/* Search aliases, as small chips. */}
            {asset.aliases.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {asset.aliases.map((alias) => (
                  <span
                    key={alias}
                    className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
                  >
                    {alias}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-4">
              {/* Open issues first — resolve/acknowledge before piling on. */}
              {issuesHere.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>Open issues</Label>
                  {issuesHere.map((issue) => (
                    <OpenIssueRow
                      key={issue.id}
                      issue={issue}
                      categories={categories}
                      canEdit={can.edit}
                      canSubmit={can.submit}
                      online={online}
                    />
                  ))}
                </div>
              )}

              {/* Report issue — the default action, expanded and ready.
                  Re-keyed by asset so form state never survives a switch to a
                  different asset. */}
              {can.submit && (
                <ReportIssueForm
                  key={asset.id}
                  asset={asset}
                  glassChild={glassChild}
                  glassNumbers={glassNumbers}
                  item={null}
                  categories={categories}
                  supervisors={supervisors}
                  online={online}
                  onReported={onIssueReported}
                />
              )}

              {/* Pass/Fail condition check — walk-only (checks belong to an
                  inspection record), submit-tier. */}
              {walkActive && can.submit && (
                <AssetCheckBlock
                  key={`check-${asset.id}`}
                  asset={asset}
                  glassChild={glassChild}
                  glassNumbers={glassNumbers}
                  assetChecks={assetChecks}
                  pending={checkPending}
                  onSave={onSaveCheck}
                />
              )}

              {/* Replacement spec — the ordering info when glass breaks.
                  Read-only here; spec entry lives in the admin perimeter
                  editor. */}
              {specTarget && <SpecInfo target={specTarget} />}

              {/* Collapsed full history (online only). */}
              <HistoryBlock
                history={detail?.history ?? null}
                loading={detailLoading}
                online={online}
                currentDisplayLabel={labelInfo.display}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// Per-asset Pass/Fail check with a notes box. Tapping Pass or Fail saves
// immediately (with whatever note is typed). A board position's check can
// target the board OR its glass — same board/glass toggle as ReportIssueForm.
function AssetCheckBlock({
  asset,
  glassChild,
  glassNumbers,
  assetChecks,
  pending,
  onSave,
}: {
  asset: PerimeterAsset
  glassChild: PerimeterAsset | null
  glassNumbers: Record<string, string>
  assetChecks: Record<string, { status: "pass" | "fail"; note: string | null }>
  pending: boolean
  onSave: (assetId: string, status: "pass" | "fail", note: string | null) => void
}) {
  const [targetGlass, setTargetGlass] = useState(false)
  const targetAsset = targetGlass && glassChild ? glassChild : asset
  const current = assetChecks[targetAsset.id] ?? null
  const [note, setNote] = useState(current?.note ?? "")

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>Condition check</Label>
        {current && (
          <Badge variant={current.status === "pass" ? "success" : "destructive"}>
            {current.status === "pass" ? "Pass" : "Fail"}
          </Badge>
        )}
      </div>
      {glassChild && glassChild.is_active && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={targetGlass ? "outline" : "default"}
            onClick={() => {
              setTargetGlass(false)
              setNote(assetChecks[asset.id]?.note ?? "")
            }}
          >
            Board {asset.label}
          </Button>
          <Button
            size="sm"
            variant={targetGlass ? "default" : "outline"}
            onClick={() => {
              setTargetGlass(true)
              setNote(assetChecks[glassChild.id]?.note ?? "")
            }}
          >
            Glass {glassLabelOf(glassChild, glassNumbers)}
          </Button>
        </div>
      )}
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notes on this piece (optional)"
        rows={2}
        className="text-base"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant={current?.status === "pass" ? "default" : "outline"}
          className="flex-1"
          disabled={pending}
          onClick={() => onSave(targetAsset.id, "pass", note)}
        >
          Pass
        </Button>
        <Button
          type="button"
          variant={current?.status === "fail" ? "destructive" : "outline"}
          className="flex-1"
          disabled={pending}
          onClick={() => onSave(targetAsset.id, "fail", note)}
        >
          Fail
        </Button>
      </div>
    </div>
  )
}

// Read-only replacement-spec card (height × width lead — the ordering info).
function SpecInfo({ target }: { target: PerimeterAsset }) {
  const hasSpec =
    target.glass_width_in !== null ||
    target.glass_height_in !== null ||
    target.glass_thickness_in !== null ||
    target.glass_material !== null

  return (
    <div className="bg-muted/30 flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>Replacement spec</Label>
        {!hasSpec && (
          <span className="text-muted-foreground text-xs">No spec on file</span>
        )}
      </div>
      {hasSpec && (
        <div className="font-mono text-sm">
          <div className="text-lg font-bold">
            {target.glass_height_in ?? "—"} × {target.glass_width_in ?? "—"} in
          </div>
          <div className="text-muted-foreground">
            {target.glass_thickness_in !== null
              ? `${thicknessToFraction(target.glass_thickness_in)}" thick`
              : "thickness —"}
            {target.glass_material ? ` · ${target.glass_material}` : ""}
          </div>
          {target.spec_notes && (
            <div className="text-muted-foreground mt-1 text-xs">
              {target.spec_notes}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Collapsed resolved-issue history. `history` is preloaded by the parent
 * (one asset-detail fetch per sheet open, online only) rather than lazily on
 * expand, since the same fetch already resolves the header's zone name.
 * Each row's own `label_snapshot` — the display label AT LOG TIME — is
 * called out whenever it no longer matches the segment's current display
 * label, so a renamed segment's history still reads correctly.
 */
function HistoryBlock({
  history,
  loading,
  online,
  currentDisplayLabel,
}: {
  history: IssueRow[] | null
  loading: boolean
  online: boolean
  currentDisplayLabel: string
}) {
  return (
    <details>
      <summary className="text-muted-foreground cursor-pointer text-sm">
        Issue history
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {!online && (
          <p className="text-muted-foreground text-xs">
            History is unavailable offline.
          </p>
        )}
        {loading && <p className="text-muted-foreground text-xs">Loading…</p>}
        {history?.length === 0 && (
          <p className="text-muted-foreground text-xs">No resolved issues.</p>
        )}
        {history?.map((issue) => (
          <div key={issue.id} className="bg-muted/20 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {(issue.severity as string).toUpperCase()}
              </Badge>
              <span className="text-muted-foreground font-mono text-xs">
                <LocalDateTime iso={issue.created_at} format="date" /> →{" "}
                {issue.resolved_at ? (
                  <LocalDateTime iso={issue.resolved_at} format="date" />
                ) : (
                  ""
                )}
              </span>
            </div>
            <p className="mt-1 text-sm">{issue.description}</p>
            {issue.label_snapshot && issue.label_snapshot !== currentDisplayLabel && (
              <p className="text-muted-foreground mt-1 text-xs italic">
                logged as &ldquo;{issue.label_snapshot}&rdquo;
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}
