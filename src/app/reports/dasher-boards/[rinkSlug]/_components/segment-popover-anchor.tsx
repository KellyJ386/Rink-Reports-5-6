"use client"

// Zero-size popover anchor pinned to the selected perimeter segment. The rink
// SVG (viewBox 0 0 RINK_W RINK_H, xMidYMid meet) exactly fills its wrapper
// (which carries the matching aspect-ratio), so percentage coordinates map a
// segment's viewBox midpoint onto the wrapper box precisely and survive
// resizes. Rendered as a sibling of RinkPerimeter inside a `relative` div;
// RinkPerimeter itself is untouched.

import { useEffect, useMemo, useRef } from "react"

import { PopoverAnchor } from "@/components/ui/popover"
import {
  buildPerimeterSegments,
  PERIMETER_LENGTH,
  RINK_H,
  RINK_W,
  type PerimeterDirection,
  type PositionedAssetLite,
} from "@/components/rink/perimeter-geometry"

export function SegmentPopoverAnchor({
  positioned,
  direction,
  anchorOffsetFraction,
  assetId,
}: {
  positioned: PositionedAssetLite[]
  direction: PerimeterDirection
  anchorOffsetFraction: number
  assetId: string | null
}) {
  const ref = useRef<HTMLDivElement | null>(null)

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
  const segment = assetId
    ? (segments.find((s) => s.assetId === assetId) ?? null)
    : null

  // Guided mode opens the panel from buttons that sit below the (very tall)
  // diagram, so the tapped segment can be off-screen when the popover opens.
  // Scroll it into view only in that case — direct diagram taps are already
  // visible and must not jerk the page.
  useEffect(() => {
    if (!assetId) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewportH =
      window.visualViewport?.height ?? window.innerHeight
    if (rect.top < 0 || rect.bottom > viewportH) {
      el.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }, [assetId])

  if (!segment) return null

  return (
    <PopoverAnchor asChild>
      <div
        ref={ref}
        aria-hidden
        className="pointer-events-none absolute size-0"
        style={{
          left: `${(segment.mid.x / RINK_W) * 100}%`,
          top: `${(segment.mid.y / RINK_H) * 100}%`,
        }}
      />
    </PopoverAnchor>
  )
}
