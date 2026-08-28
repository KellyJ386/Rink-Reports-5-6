"use client"

// Guided walkthrough mode: a full-screen, one-segment-at-a-time overlay for
// stepping through a walk's ACTIVE POSITIONED segments in sequence_position
// order — the same order the perimeter diagram renders them in. It is a
// second way to drive the exact same persistence path the free-tap flow uses
// (saveAssetCheck via the parent's onOk/onFlag), so it inherits the same
// online/offline queueing for free; nothing here talks to Supabase or the
// offline queue directly.
//
// "Next unchecked" only governs the automatic advance after OK/Flag — it
// skips segments already checked THIS walk so a crew member sweeping the
// rink never re-lands on ones they already handled. Previous and Skip are
// plain step-by-step navigation and can revisit anything, checked or not.

import { useEffect, useState, type ReactNode } from "react"
import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { getAssetDetailAction } from "../../actions"
import { resolveSegmentLabel } from "../../_lib/display-label"
import type { PerimeterAsset } from "../../_lib/queries"
import type { Tables } from "@/types/database"

type SubtypeRow = Tables<"dasher_boards_asset_subtypes">

export function GuidedWalk({
  positioned,
  glassNumbers,
  doorSubtypes,
  assetChecks,
  pending,
  online,
  onOk,
  onFlag,
  onClose,
  onFinish,
}: {
  /** Active positioned segments (board_panel/door), sequence_position order. */
  positioned: PerimeterAsset[]
  glassNumbers: Record<string, string>
  doorSubtypes: SubtypeRow[]
  assetChecks: Record<string, { status: "pass" | "fail"; note: string | null }>
  pending: boolean
  online: boolean
  /** Record a pass check for this segment. */
  onOk: (assetId: string) => void
  /** Record a fail check and open the segment's issue-report sheet. */
  onFlag: (asset: PerimeterAsset) => void
  /** Close the overlay without signaling completion. */
  onClose: () => void
  /** The last unchecked segment was just handled — hand off to sign-off. */
  onFinish: () => void
}) {
  // Resume where the walk left off: the first not-yet-checked segment, or
  // the first segment if every one is already checked (nothing left to skip
  // to — let the crew member page back through for review).
  const [stepIndex, setStepIndex] = useState(() => {
    const idx = positioned.findIndex((a) => !assetChecks[a.id])
    return idx === -1 ? 0 : idx
  })

  const total = positioned.length
  const asset = positioned[Math.min(stepIndex, Math.max(total - 1, 0))] ?? null

  // Zone name isn't on PerimeterAsset (zone_id has no name attached) —
  // resolved the same way AssetSheet does, one fetch per segment, online
  // only. Re-keyed by asset id so a stale fetch can't paint the wrong step.
  const [loaded, setLoaded] = useState<{
    assetId: string
    zoneName: string | null
  } | null>(null)
  const assetId = asset?.id ?? null
  useEffect(() => {
    if (!assetId || !online) return
    let cancelled = false
    void getAssetDetailAction(assetId).then((r) => {
      if (cancelled) return
      setLoaded({ assetId, zoneName: r.ok ? r.detail.zoneName : null })
    })
    return () => {
      cancelled = true
    }
  }, [assetId, online])
  const zoneName = loaded?.assetId === assetId ? loaded.zoneName : null
  const zoneLoading = online && assetId !== null && loaded?.assetId !== assetId

  if (!asset || total === 0) {
    return (
      <GuidedWalkShell onClose={onClose}>
        <p className="text-muted-foreground p-6 text-sm">
          No positioned segments on this rink yet.
        </p>
      </GuidedWalkShell>
    )
  }

  const labelInfo = resolveSegmentLabel(asset, glassNumbers)
  const typeLabel =
    asset.asset_type === "door"
      ? (doorSubtypes.find((s) => s.id === asset.subtype_id)?.label ?? "Door")
      : "Board panel"
  const current = assetChecks[asset.id] ?? null
  const position = stepIndex + 1

  // Jump to the next segment not yet checked THIS walk; when none remain
  // ahead, the walkthrough is done.
  function advance() {
    for (let i = stepIndex + 1; i < positioned.length; i++) {
      if (!assetChecks[positioned[i].id]) {
        setStepIndex(i)
        return
      }
    }
    onFinish()
  }

  function goPrevious() {
    setStepIndex((i) => Math.max(0, i - 1))
  }

  function handleSkip() {
    if (stepIndex >= positioned.length - 1) {
      onFinish()
      return
    }
    setStepIndex((i) => i + 1)
  }

  function handleOk() {
    onOk(asset!.id)
    advance()
  }

  function handleFlag() {
    onFlag(asset!)
    advance()
  }

  return (
    <GuidedWalkShell onClose={onClose}>
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-muted-foreground text-xs font-medium">
          Segment {position} of {total}
        </span>
        {current && (
          <Badge variant={current.status === "pass" ? "success" : "destructive"}>
            {current.status === "pass" ? "Already passed" : "Already flagged"}
          </Badge>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Guided walkthrough progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={position}
        className="bg-muted mx-4 mt-2 h-1.5 overflow-hidden rounded-full"
      >
        <div
          aria-hidden
          className="bg-primary h-full rounded-full transition-all"
          style={{ width: `${(position / total) * 100}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge variant={asset.asset_type === "door" ? "special" : "secondary"}>
            {typeLabel}
          </Badge>
          {asset.out_of_service && <Badge variant="warning">Out of service</Badge>}
        </div>
        <p className="font-mono text-5xl font-bold tracking-tight">
          {labelInfo.display}
        </p>
        {labelInfo.display !== labelInfo.identity && (
          <p className="text-muted-foreground font-mono text-sm">
            ({labelInfo.identity})
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          {zoneLoading
            ? "Loading zone…"
            : zoneName
              ? `Zone: ${zoneName}`
              : online
                ? "No zone assigned"
                : "Zone unavailable offline"}
        </p>
        {asset.aliases.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
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
      </div>

      <div className="flex gap-3 px-4">
        <Button
          type="button"
          size="lg"
          className="h-16 flex-1 text-lg"
          disabled={pending}
          onClick={handleOk}
        >
          OK
        </Button>
        <Button
          type="button"
          size="lg"
          variant="destructive"
          className="h-16 flex-1 text-lg"
          disabled={pending}
          onClick={handleFlag}
        >
          Flag
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t p-4">
        <Button
          variant="outline"
          onClick={goPrevious}
          disabled={pending || stepIndex === 0}
        >
          Previous
        </Button>
        <Button variant="outline" onClick={handleSkip} disabled={pending}>
          Skip
        </Button>
      </div>
    </GuidedWalkShell>
  )
}

function GuidedWalkShell({
  children,
  onClose,
}: {
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm font-semibold">Guided walkthrough</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close guided walkthrough"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      {children}
    </div>
  )
}
