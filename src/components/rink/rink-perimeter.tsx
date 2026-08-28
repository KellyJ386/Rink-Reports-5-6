"use client"

// Dasher Boards perimeter diagram — a SIBLING of the Ice Depth USARink
// component (deliberately not shared code: ice-depth's diagram is
// WCAG-tuned and offline-critical, so its regression surface stays at zero).
// Draws the same 380×740 ice surface, then the ordered ring of board/door
// segments around it.
//
// Color contract (product decision): red (#F42A2A) and yellow (#FFD600) are
// RESERVED for condition state — open severity-A and open B/C issues
// respectively. A door's at-rest identity is the lime accent (#4DFF00) plus a
// break in the board line; it is never red or yellow unless it has open
// issues. Non-color cues: doors get a glyph, condition gets a "!" marker.
//
// "flagged" (coral #FF7B4F — the palette's "warm attention" hue, distinct
// from red/yellow/lime/glass-blue) is a Fail walk-check with no open issue
// backing it yet: surfaced but not escalated into the issue pipeline. It
// always loses to an open issue of any severity (see combineDisplayCondition
// in reports/dasher-boards/_lib/compute.ts) — an open issue is the
// actively-tracked problem.
//
// Segment labels (migration 257): each segment prints resolveSegmentLabel's
// resolution (custom_label > glass number > the permanent `label`), never
// the raw identity directly, so a facility's own naming shows everywhere.
// Label declutter: a label ALWAYS renders when its segment is flagged/has an
// open issue, is out of service, is selected, or is search-highlighted;
// otherwise it only renders once the segment's on-screen span clears
// LABEL_DECLUTTER_MIN_SPAN — the same "span too small to read reliably"
// problem the interactive hit-band comment below already describes for taps,
// reused here for text. Zooming (staff map) or a smaller position count
// (admin, desktop-first, always at scale 1) both restore it.
//
// Out of service is a distinct hazard, layered over — never replacing — the
// severity stroke color: reduced opacity + (for boards) an added dash
// pattern, plus a small neutral "×" marker chip offset further outward than
// the condition "!" chip so the two never collide. Uses theme CSS vars
// (var(--muted-foreground) / var(--background)), the same
// stroke="var(--ring)" convention the sibling Ice Depth diagram uses for
// non-severity chrome, so it never hardcodes a color that would break dark
// mode.

import { useId, useMemo, useRef } from "react"

import { RinkMarkings } from "@/components/ice-depth/usa-rink"
import { useDiagramZoom } from "./use-diagram-zoom"
import { ZoomControls } from "./zoom-controls"

import {
  boundaryPathD,
  buildPerimeterSegments,
  nearestArcLength,
  perimeterNormalAt,
  perimeterPointAt,
  PERIMETER_LENGTH,
  RINK_H,
  RINK_W,
  type PerimeterDirection,
  type PerimeterSegment,
  type PositionedAssetLite,
} from "./perimeter-geometry"
import { resolveSegmentLabel } from "@/app/reports/dasher-boards/_lib/display-label"

export type PerimeterCondition = "warn" | "alert" | "flagged"

export type RinkPerimeterGlass = {
  id: string
  label: string
  parentBoardId: string
  isActive: boolean
  hasSpec: boolean
}

export type RinkPerimeterProps = {
  /** Active positioned assets (boards + doors) in sequence order. */
  positioned: PositionedAssetLite[]
  direction: PerimeterDirection
  /**
   * Where sequence position 1 starts drawing, as a fraction [0, 1) of the
   * boundary's arc length (the rink's `perimeter_anchor_offset`). Purely a
   * rendering rotation — never changes which asset is which. Default 0 =
   * top-middle, the historical fixed start.
   */
  anchorOffsetFraction?: number
  /** Glass rows keyed by parent board id (for the glass layer). */
  glassByParent?: Record<string, RinkPerimeterGlass>
  /**
   * The facility's own glass numbers, keyed by the POSITION's asset id (the
   * board or door — computeGlassNumbers keys both the position and its glass
   * child). Drawn inside the ring alongside the glass layer, so a walker sees
   * the number that is physically on the panel in front of them. Absent =
   * numbering is off for this rink and only the permanent labels show.
   */
  glassNumberByAssetId?: Record<string, string>
  /** Open-issue condition per asset id (assets absent = clear). */
  conditionByAssetId?: Record<string, PerimeterCondition>
  selectedAssetId?: string | null
  onSelectAsset?: (assetId: string) => void
  /**
   * Search-match asset ids (see matchingSegmentIds in
   * reports/dasher-boards/_lib/display-label). `undefined` = no search UI is
   * active, so nothing dims. Defined (including an empty set, i.e. zero
   * matches) = a query is active: matching segments get a pulsing ring,
   * everything else dims. Staff condition map only — the admin editor has no
   * search box.
   */
  highlightedIds?: ReadonlySet<string>
  showGlassLayer?: boolean
  showLabels?: boolean
  /**
   * Pinch-zoom / pan for phone-sized viewports. At a full perimeter (30–64
   * positions) an individual segment's rendered hit target drops well below
   * the 44px minimum on a 380px screen; zooming restores reliable taps.
   * Enabled on the staff condition map; admin editors are desktop-first.
   */
  zoomable?: boolean
  className?: string
  /**
   * When set, the diagram enters "pick a start point" mode: the whole
   * boundary becomes a click target, and clicking anywhere on it reports the
   * nearest arc-length fraction. Admin-only (see PerimeterTab's "Set start
   * point" toggle) — staff-facing renders never pass this.
   */
  onPickAnchor?: (offsetFraction: number) => void
}

const BOARD_COLOR = "#33475e"
const DOOR_COLOR = "#4DFF00"
const DOOR_INK = "#1A9B00"
const SELECT_COLOR = "#4DFF00"
const WARN_COLOR = "#FFD600"
const ALERT_COLOR = "#F42A2A"
const FLAG_COLOR = "#FF7B4F"
const GLASS_COLOR = "#5aa9d6"
// Search-match ring — a theme CSS var (adapts light/dark automatically,
// same convention as usa-rink.tsx's stroke="var(--ring)"), deliberately NOT
// the lime SELECT_COLOR so a highlighted-but-unselected segment never reads
// as selected.
const SEARCH_HIGHLIGHT_COLOR = "var(--info)"
// Out-of-service marker — neutral, theme-aware, distinct from every
// severity/door/selection color above (out of service is an operator status,
// not a condition severity).
const OOS_MARKER_FILL = "var(--muted-foreground)"
const OOS_MARKER_INK = "var(--background)"

// A label declutters below this on-screen span (SVG viewBox units, ~= CSS
// px at the diagram's native render width). At a full 60+ position perimeter
// unzoomed this is comfortably under the threshold; zooming in (staff map)
// or a shorter perimeter (admin, always effectively at scale 1) clears it.
// See the header comment for the forced-visible exceptions.
const LABEL_DECLUTTER_MIN_SPAN = 36
// Radial spacing (SVG units) between stacked outward chips — the condition
// "!" badge, the out-of-service "×" chip, and the text label — so up to all
// three can render on one segment without overlapping.
const CHIP_TIER_STEP = 11

function segmentStroke(
  seg: PerimeterSegment,
  condition: PerimeterCondition | undefined,
): string {
  if (condition === "alert") return ALERT_COLOR
  if (condition === "warn") return WARN_COLOR
  if (condition === "flagged") return FLAG_COLOR
  return seg.assetType === "door" ? DOOR_COLOR : BOARD_COLOR
}

/** Marker chip fill (the "!" badge outward of the span). */
function conditionMarkerFill(condition: PerimeterCondition): string {
  if (condition === "alert") return ALERT_COLOR
  if (condition === "warn") return WARN_COLOR
  return FLAG_COLOR
}

/** Marker chip text ink — white reads AA on red/coral, navy reads AA on yellow. */
function conditionMarkerInk(condition: PerimeterCondition): string {
  return condition === "warn" ? "#002244" : "#FFFFFF"
}

export function RinkPerimeter({
  positioned,
  direction,
  anchorOffsetFraction = 0,
  glassByParent,
  glassNumberByAssetId,
  conditionByAssetId,
  selectedAssetId,
  onSelectAsset,
  highlightedIds,
  showGlassLayer = false,
  showLabels = true,
  zoomable = false,
  className,
  onPickAnchor,
}: RinkPerimeterProps) {
  const uid = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useDiagramZoom(RINK_W, RINK_H)
  const anchorOffset = anchorOffsetFraction * PERIMETER_LENGTH
  const segments = useMemo(
    () => buildPerimeterSegments(positioned, direction, anchorOffset),
    [positioned, direction, anchorOffset],
  )
  // Keyed lookup back to the asset's display-layer columns — buildPerimeterSegments
  // only carries geometry + the permanent label, so custom_label/aliases/
  // out_of_service ride along via the original positioned list instead of
  // widening PerimeterSegment.
  const assetById = useMemo(
    () => new Map(positioned.map((a) => [a.id, a])),
    [positioned],
  )
  const searchActive = highlightedIds !== undefined
  // Admin editors pass zoomable=false and stay at scale 1 always (desktop-
  // first, no pinch/pan) — the SAME span-threshold math then declutters
  // purely by position count, no special-casing needed.
  const zoomScale = zoomable ? zoom.scale : 1
  const interactive = typeof onSelectAsset === "function"
  const pickingAnchor = typeof onPickAnchor === "function"
  const anchorPoint = perimeterPointAt(anchorOffset)
  const anchorNormal = perimeterNormalAt(anchorOffset)
  const anchorCaption = {
    x: anchorPoint.x + anchorNormal.x * 26,
    y: anchorPoint.y + anchorNormal.y * 26,
  }

  function handleBoundaryClick(e: React.PointerEvent<SVGPathElement>) {
    const svg = svgRef.current
    if (!svg || !onPickAnchor) return
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(ctm.inverse())
    const s = nearestArcLength({ x: local.x, y: local.y })
    onPickAnchor(s / PERIMETER_LENGTH)
  }

  return (
    <div
      className={zoomable ? `relative ${className ?? ""}` : className}
      style={{ aspectRatio: `${RINK_W}/${RINK_H}` }}
    >
      <svg
        ref={(el) => {
          svgRef.current = el
          if (zoomable) zoom.svgProps.ref(el)
        }}
        viewBox={zoomable ? zoom.viewBox : `0 0 ${RINK_W} ${RINK_H}`}
        className={pickingAnchor ? "h-auto w-full cursor-crosshair" : "h-auto w-full"}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Rink perimeter diagram"
        {...(zoomable
          ? {
              style: zoom.svgProps.style,
              onPointerDown: zoom.svgProps.onPointerDown,
              onPointerMove: zoom.svgProps.onPointerMove,
              onPointerUp: zoom.svgProps.onPointerUp,
              onPointerCancel: zoom.svgProps.onPointerCancel,
              onClickCapture: zoom.svgProps.onClickCapture,
            }
          : {})}
      >
        {/* The SAME USA Hockey ice surface the Ice Depth diagram renders
            (shared markup, imported) — the board ring wraps around it.
            pointer-events off so markings never steal the segments' taps. */}
        <g pointerEvents="none" aria-hidden="true">
          <RinkMarkings />
        </g>

        {/* "Pick a start point" hit target — the whole boundary, so it works
            even before any assets exist (the wizard's empty-ring preview).
            Wide transparent stroke for an easy tap target; a thin dashed
            highlight underneath signals the mode is active. */}
        {pickingAnchor && (
          <>
            <path
              d={boundaryPathD()}
              fill="none"
              stroke={SELECT_COLOR}
              strokeWidth={2}
              strokeDasharray="4 4"
              opacity={0.5}
              pointerEvents="none"
            />
            <path
              d={boundaryPathD()}
              fill="none"
              stroke="transparent"
              strokeWidth={28}
              role="button"
              aria-label="Click a spot on the boundary to set the perimeter start point"
              onPointerDown={handleBoundaryClick}
            />
          </>
        )}

        {/* Glass layer (inside the boards). */}
        {showGlassLayer &&
          segments.map((seg) => {
            const glass =
              seg.assetType === "board_panel"
                ? glassByParent?.[seg.assetId]
                : undefined
            if (seg.assetType === "door") return null
            return (
              <path
                key={`glass-${seg.assetId}`}
                d={seg.glassPathD}
                fill="none"
                stroke={GLASS_COLOR}
                strokeWidth={glass?.isActive ? 2.5 : 1.25}
                strokeDasharray={glass?.isActive ? undefined : "3 4"}
                opacity={glass ? (glass.isActive ? 0.9 : 0.4) : 0.15}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )
          })}

        {/* Glass numbers — the facility's own numbering, inside the ring.
            Painted with the glass layer (same mental mode: "show me the
            glass") and only where there IS glass: an active glass child, or a
            door, which carries its own. */}
        {showGlassLayer &&
          glassNumberByAssetId &&
          segments.map((seg) => {
            const number = glassNumberByAssetId[seg.assetId]
            if (!number) return null
            const hasGlass =
              seg.assetType === "door" ||
              glassByParent?.[seg.assetId]?.isActive === true
            if (!hasGlass) return null
            return (
              <text
                key={`glass-num-${seg.assetId}`}
                x={seg.glassLabelAnchor.x}
                y={seg.glassLabelAnchor.y + 3.2}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={600}
                fill={GLASS_COLOR}
                className="font-mono"
                pointerEvents="none"
              >
                {number}
              </text>
            )
          })}

        {/* Board / door segments. */}
        {segments.map((seg) => {
          const condition = conditionByAssetId?.[seg.assetId]
          const selected = selectedAssetId === seg.assetId
          const asset = assetById.get(seg.assetId)
          const outOfService = asset?.out_of_service ?? false
          const isHighlighted = highlightedIds?.has(seg.assetId) ?? false
          const dimmed = searchActive && !isHighlighted
          const stroke = segmentStroke(seg, condition)
          const isDoor = seg.assetType === "door"

          // custom_label > glass number > the permanent `label` — the same
          // resolution everywhere a segment's name is printed (see
          // reports/dasher-boards/_lib/display-label).
          const labelInfo = resolveSegmentLabel(
            {
              id: seg.assetId,
              label: seg.label,
              asset_type: seg.assetType,
              custom_label: asset?.custom_label ?? null,
              aliases: asset?.aliases ? [...asset.aliases] : [],
            },
            glassNumberByAssetId,
          )

          // Declutter: forced visible on flagged/open-issue, out-of-service,
          // selected, or search-highlighted segments; otherwise only once the
          // segment's on-screen span clears the threshold.
          const forceLabel = !!condition || outOfService || selected || isHighlighted
          const spanUnits = seg.endS - seg.startS
          const shouldShowLabel =
            showLabels &&
            (forceLabel || spanUnits * zoomScale >= LABEL_DECLUTTER_MIN_SPAN)

          // The condition "!" badge, the out-of-service "×" chip, and the
          // text label stack radially outward (in that priority order) along
          // the SAME direction seg.labelAnchor already sits on, so at most
          // one occupies each tier and none overlap. With neither badge nor
          // chip present (the common case) the label stays at tier 0 —
          // pixel-identical to the pre-declutter placement.
          const dx = seg.labelAnchor.x - seg.mid.x
          const dy = seg.labelAnchor.y - seg.mid.y
          const dlen = Math.hypot(dx, dy) || 1
          const ux = dx / dlen
          const uy = dy / dlen
          const tierAnchor = (tier: number) => ({
            x: seg.mid.x + ux * (dlen + tier * CHIP_TIER_STEP),
            y: seg.mid.y + uy * (dlen + tier * CHIP_TIER_STEP),
          })
          let nextTier = 0
          const conditionAnchor = condition ? tierAnchor(nextTier++) : null
          const oosAnchor = outOfService ? tierAnchor(nextTier++) : null
          const textAnchor = nextTier === 0 ? seg.labelAnchor : tierAnchor(nextTier)

          return (
            <g
              key={seg.assetId}
              opacity={dimmed ? 0.35 : undefined}
              {...(interactive
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `${isDoor ? "Door" : "Board panel"} ${labelInfo.display}${
                      labelInfo.display !== labelInfo.identity
                        ? ` (${labelInfo.identity})`
                        : ""
                    }${
                      glassNumberByAssetId?.[seg.assetId]
                        ? `, glass ${glassNumberByAssetId[seg.assetId]}`
                        : ""
                    }${outOfService ? ", out of service" : ""}${
                      condition === "alert"
                        ? ", open severity A issue"
                        : condition === "warn"
                          ? ", open issue"
                          : condition === "flagged"
                            ? ", flagged fail — no issue reported yet"
                            : ""
                    }`,
                    onClick: () => onSelectAsset?.(seg.assetId),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelectAsset?.(seg.assetId)
                      }
                    },
                    className: "cursor-pointer focus:outline-none",
                  }
                : // Non-interactive (e.g. pick-anchor mode): the visible board/
                  // door strokes must not swallow taps meant for the boundary
                  // pick target underneath.
                  { pointerEvents: "none" as const })}
            >
              {/* Enlarged transparent hit area. Butt caps so a segment's hit
                  zone never extends past its own span and steals the
                  neighbor's taps; 34 SVG units of stroke ≈ the full board
                  band + margin at typical phone render widths. Keyboard
                  selection (Tab + Enter) covers precision taps at high
                  position counts, where per-segment width is physics-bound. */}
              {interactive && (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={34}
                  strokeLinecap="butt"
                />
              )}
              {/* Number tap halo: the label/condition chip sits ~16 units
                  OUTWARD of the board line, past the 34-unit hit band, so a tap
                  on the number itself (the natural target) can miss. A
                  transparent disc centered on the label anchor makes the whole
                  number a reliable tap target — and, because the "!" condition
                  chip renders at the same anchor, it fixes issue-bearing assets
                  too (whose number is replaced by the non-interactive chip). */}
              {interactive && (
                <circle
                  cx={seg.labelAnchor.x}
                  cy={seg.labelAnchor.y}
                  r={13}
                  fill="transparent"
                />
              )}
              {/* Selection halo. */}
              {selected && (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke={SELECT_COLOR}
                  strokeWidth={12}
                  strokeLinecap="round"
                  opacity={0.35}
                />
              )}
              {/* Search-match halo: a pulsing ring, distinct from the
                  selection color, so the two never read as the same state. */}
              {isHighlighted && (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke={SEARCH_HIGHLIGHT_COLOR}
                  strokeWidth={10}
                  strokeLinecap="round"
                  opacity={0.6}
                  className="animate-pulse"
                  pointerEvents="none"
                />
              )}
              {isDoor ? (
                <>
                  {/* Door identity: a deliberate break in the board line —
                      two board-colored stubs (one at EACH end, via a
                      normalized pathLength so the dash pattern spans the
                      whole segment exactly once) + a lime door leaf. Out of
                      service dims both (layered, not replacing color) — the
                      door's own dash pattern already carries meaning, so it
                      isn't further dashed. */}
                  <path
                    d={seg.pathD}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={7}
                    strokeLinecap="round"
                    pathLength={100}
                    strokeDasharray="12 76"
                    opacity={outOfService ? 0.55 : undefined}
                  />
                  <path
                    d={seg.pathD}
                    fill="none"
                    stroke={condition ? stroke : DOOR_COLOR}
                    strokeWidth={7}
                    strokeLinecap="butt"
                    // Leaf: the middle ~60% of the span only.
                    pathLength={100}
                    strokeDasharray="60 100"
                    strokeDashoffset={-20}
                    opacity={outOfService ? 0.55 : undefined}
                  />
                  {/* Door glyph (non-color cue): hinge dot at the span mid. */}
                  <circle
                    cx={seg.mid.x}
                    cy={seg.mid.y}
                    r={3}
                    fill={condition ? "#FFFFFF" : DOOR_INK}
                    stroke={condition ? stroke : DOOR_INK}
                    strokeWidth={1.5}
                    opacity={outOfService ? 0.55 : undefined}
                    pointerEvents="none"
                  />
                </>
              ) : (
                <path
                  d={seg.pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={7}
                  strokeLinecap="round"
                  // Out-of-service hazard treatment: layered over the
                  // severity/board color, never replacing it — an added dash
                  // pattern + reduced opacity, plus the "×" chip below.
                  strokeDasharray={outOfService ? "5 4" : undefined}
                  opacity={outOfService ? 0.6 : undefined}
                />
              )}
              {/* Condition marker (non-color cue): "!" chip outward of span. */}
              {condition && conditionAnchor && (
                <g pointerEvents="none">
                  <circle
                    cx={conditionAnchor.x}
                    cy={conditionAnchor.y}
                    r={9}
                    fill={conditionMarkerFill(condition)}
                    stroke="#FFFFFF"
                    strokeWidth={1.25}
                  />
                  <text
                    x={conditionAnchor.x}
                    y={conditionAnchor.y + 3.8}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={800}
                    fill={conditionMarkerInk(condition)}
                  >
                    !
                  </text>
                </g>
              )}
              {/* Out-of-service marker (non-color cue): neutral "×" chip,
                  stacked outward past the condition badge when both apply. */}
              {outOfService && oosAnchor && (
                <g pointerEvents="none">
                  <circle
                    cx={oosAnchor.x}
                    cy={oosAnchor.y}
                    r={8}
                    fill={OOS_MARKER_FILL}
                    stroke={OOS_MARKER_INK}
                    strokeWidth={1.25}
                  />
                  <text
                    x={oosAnchor.x}
                    y={oosAnchor.y + 3.4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={800}
                    fill={OOS_MARKER_INK}
                  >
                    ×
                  </text>
                </g>
              )}
              {/* Label (Space Mono via the app's mono font stack): the
                  resolved display name (custom_label > glass number >
                  identity), never the raw identity directly. */}
              {shouldShowLabel && (
                <text
                  x={textAnchor.x}
                  y={textAnchor.y + 3.6}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={600}
                  className="fill-muted-foreground font-mono"
                  pointerEvents="none"
                >
                  {labelInfo.display}
                </text>
              )}
            </g>
          )
        })}

        {/* Glass tap targets. When the glass layer is shown on an interactive
            diagram, let a user tap the glass directly. Painted AFTER the board
            groups so it wins pointer events in the glass band; pointer-only
            (no role/tabIndex) so it doesn't double the keyboard tab stops —
            keyboard/AT users already reach the position via the board group.
            The glass path is drawn per board segment, so selecting seg.assetId
            opens that board's sheet, whose spec block already targets the
            board's glass child (glass is 1:1 with its board). */}
        {interactive &&
          showGlassLayer &&
          segments.map((seg) => {
            if (seg.assetType === "door") return null
            const glass = glassByParent?.[seg.assetId]
            if (!glass?.isActive) return null
            return (
              <path
                key={`glass-hit-${seg.assetId}`}
                d={seg.glassPathD}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                strokeLinecap="butt"
                className="cursor-pointer"
                aria-hidden="true"
                onClick={() => onSelectAsset?.(seg.assetId)}
              />
            )
          })}

        {/* Anchor marker: where position 1 starts — the facility-settable
            start point (default top-middle). Offset further outward than the
            label ring so it never collides with the top-edge asset labels,
            wherever on the ring it sits. */}
        <g pointerEvents="none" aria-hidden="true">
          <circle cx={anchorPoint.x} cy={anchorPoint.y} r={2.5} fill="#8A92A0" />
          <text
            x={anchorCaption.x}
            y={anchorCaption.y}
            textAnchor="middle"
            fontSize={9}
            className="fill-muted-foreground font-mono"
          >
            {`pos 1 ${direction === "clockwise" ? "→" : "←"}`}
          </text>
        </g>
        <title id={`${uid}-title`}>Rink perimeter</title>
      </svg>

      {zoomable && <ZoomControls zoom={zoom} />}
    </div>
  )
}
