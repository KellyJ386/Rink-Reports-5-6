"use client"

// Compact tap-to-log popover, sized and anchored like the ice-depth reading
// popover: a small card pinned to the tapped perimeter segment with just the
// essentials — severity, category, description, save. Everything else (open
// issues, walk check with notes, replacement spec, history) lives behind the
// "Details" action, which opens the full bottom sheet (asset-sheet.tsx).
//
// Positioning accounts for the diagram's zoom/pan (the parent owns the
// useDiagramZoom state and passes its view window): the segment midpoint in
// viewBox coordinates is projected into container percentages, clamped so
// edge segments keep the card on screen, and flipped below the point when
// the segment sits near the top of the view.

import { useMemo } from "react"
import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  buildPerimeterSegments,
  PERIMETER_LENGTH,
  RINK_H,
  RINK_W,
  type PerimeterDirection,
  type PositionedAssetLite,
} from "@/components/rink/perimeter-geometry"

import type { PerimeterAsset } from "../../_lib/queries"
import { ReportIssueForm } from "./issue-form"
import type { Tables } from "@/types/database"

type CategoryRow = Tables<"dasher_boards_issue_categories">

export function AssetPopover({
  asset,
  glassChild,
  positioned,
  direction,
  anchorOffsetFraction,
  view,
  openIssueCount,
  categories,
  supervisors,
  can,
  online,
  walkActive,
  checkStatus,
  checkPending,
  onSaveCheck,
  onIssueReported,
  onOpenDetails,
  onClose,
}: {
  asset: PerimeterAsset
  glassChild: PerimeterAsset | null
  positioned: PositionedAssetLite[]
  direction: PerimeterDirection
  anchorOffsetFraction: number
  /** Live zoom view window from useDiagramZoom. */
  view: { vx: number; vy: number; scale: number }
  openIssueCount: number
  categories: CategoryRow[]
  supervisors: Array<{ id: string; name: string }>
  can: { submit: boolean; edit: boolean; admin: boolean }
  online: boolean
  walkActive: boolean
  checkStatus: "pass" | "fail" | null
  checkPending: boolean
  onSaveCheck: (assetId: string, status: "pass" | "fail", note: string | null) => void
  onIssueReported: (checklistItemId: string | null) => void
  onOpenDetails: () => void
  onClose: () => void
}) {
  // Same inputs RinkPerimeter feeds buildPerimeterSegments, so the computed
  // midpoints are identical to the segments the user sees.
  const segments = useMemo(
    () =>
      buildPerimeterSegments(
        positioned,
        direction,
        anchorOffsetFraction * PERIMETER_LENGTH,
      ),
    [positioned, direction, anchorOffsetFraction],
  )
  const segment = segments.find((s) => s.assetId === asset.id)
  if (!segment) return null

  const spanW = RINK_W / view.scale
  const spanH = RINK_H / view.scale
  const leftPct = ((segment.mid.x - view.vx) / spanW) * 100
  const topPct = Math.min(
    Math.max(((segment.mid.y - view.vy) / spanH) * 100, 2),
    98,
  )
  // Near the top of the view the card flips below the segment.
  const above = topPct > 32

  return (
    <div
      key={asset.id}
      role="dialog"
      aria-label={`Log issue on ${asset.label}`}
      className="bg-card absolute z-30 flex w-60 flex-col gap-2 rounded-lg border p-3 shadow-xl"
      style={{
        // clamp keeps the 240px card fully on screen for edge segments
        // (7.5rem = half the card width).
        left: `clamp(7.5rem, ${leftPct}%, calc(100% - 7.5rem))`,
        top: `${topPct}%`,
        transform: `translate(-50%, ${above ? "calc(-100% - 14px)" : "14px"})`,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-sm font-bold">{asset.label}</span>
          <Badge variant={asset.asset_type === "door" ? "special" : "secondary"}>
            {asset.asset_type === "door" ? "Door" : "Board"}
          </Badge>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Close"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>

      {openIssueCount > 0 && (
        <button
          type="button"
          className="text-warning-soft-foreground text-left text-xs underline underline-offset-2"
          onClick={onOpenDetails}
        >
          {openIssueCount} open issue(s) — view
        </button>
      )}

      {/* Quick walk check (board-level; the glass toggle and notes live in
          Details). Saves immediately, same plumbing as the sheet. */}
      {walkActive && can.submit && (
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            variant={checkStatus === "pass" ? "default" : "outline"}
            disabled={checkPending}
            onClick={() => onSaveCheck(asset.id, "pass", null)}
          >
            Pass
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1"
            variant={checkStatus === "fail" ? "destructive" : "outline"}
            disabled={checkPending}
            onClick={() => onSaveCheck(asset.id, "fail", null)}
          >
            Fail
          </Button>
        </div>
      )}

      {can.submit && (
        <ReportIssueForm
          key={asset.id}
          asset={asset}
          glassChild={glassChild}
          item={null}
          categories={categories}
          supervisors={supervisors}
          online={online}
          compact
          onReported={onIssueReported}
        />
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={onOpenDetails}
      >
        Details — issues, spec, history
      </Button>
    </div>
  )
}
