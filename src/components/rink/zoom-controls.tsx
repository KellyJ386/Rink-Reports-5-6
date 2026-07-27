"use client"

// Overlay button cluster for a zoomable rink diagram: pinch covers touch,
// these cover desktop + accessibility and make the affordance discoverable.

import { Shrink, ZoomIn, ZoomOut } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { DiagramZoom } from "./use-diagram-zoom"

export function ZoomControls({ zoom }: { zoom: DiagramZoom }) {
  return (
    <div className="absolute right-2 top-2 flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Zoom in"
        className="bg-background/90 size-9"
        onClick={zoom.zoomIn}
      >
        <ZoomIn aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Zoom out"
        className="bg-background/90 size-9"
        disabled={!zoom.isZoomed}
        onClick={zoom.zoomOut}
      >
        <ZoomOut aria-hidden />
      </Button>
      {zoom.isZoomed && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Reset zoom"
          className="bg-background/90 size-9"
          onClick={zoom.reset}
        >
          <Shrink aria-hidden />
        </Button>
      )}
    </div>
  )
}
