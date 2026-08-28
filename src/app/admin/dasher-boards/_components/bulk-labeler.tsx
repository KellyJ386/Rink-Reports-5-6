"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import {
  bulkLabelPatternSchema,
  buildBulkLabelPreview,
  findDuplicateLabels,
  type BulkLabelDirection,
} from "@/app/reports/dasher-boards/_lib/segment-labels"

import { applyBulkLabels } from "../actions"
import type { AssetRow, RinkRow, ZoneRow } from "../types"

const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm"

type TargetMode = "zone" | "range"

/** Empty string parses to a NaN sentinel, not 0 — so an unfilled numeric
 * field renders as invalid instead of silently defaulting. */
function parseIntField(value: string): number {
  const trimmed = value.trim()
  if (trimmed === "") return NaN
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.trunc(n) : NaN
}

/**
 * Bulk labeling — relabel a zone or a contiguous perimeter range in one pass.
 * The preview (buildBulkLabelPreview) and the collision check
 * (findDuplicateLabels) are the same pure helpers the commit action
 * re-validates against server-side, so what the admin sees here is exactly
 * what applyBulkLabels will apply.
 */
export function BulkLabelCard({
  rink,
  positioned,
  zones,
  assets,
}: {
  rink: RinkRow
  /** Active, positioned segments in perimeter order (glass excluded). */
  positioned: AssetRow[]
  /** Active zones only — the assignable set for the "zone" target mode. */
  zones: ZoneRow[]
  /** Every asset on the rink, for the "already used elsewhere" collision check. */
  assets: AssetRow[]
}) {
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<TargetMode>("zone")
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "")
  const [fromIdx, setFromIdx] = useState(0)
  const [toIdx, setToIdx] = useState(Math.max(positioned.length - 1, 0))
  const [prefix, setPrefix] = useState("")
  const [startText, setStartText] = useState("1")
  const [stepText, setStepText] = useState("1")
  const [direction, setDirection] = useState<BulkLabelDirection>("with_sequence")

  // Derived, not synced: the picked zone falls back to the first zone when the
  // list changes underneath it (e.g. the Zones card deactivated it), and the
  // range pickers clamp if the perimeter shrinks — no effects needed.
  const effectiveZoneId =
    zoneId && zones.some((z) => z.id === zoneId) ? zoneId : (zones[0]?.id ?? "")
  const maxIdx = Math.max(positioned.length - 1, 0)
  const effectiveFromIdx = Math.min(fromIdx, maxIdx)
  const effectiveToIdx = Math.min(toIdx, maxIdx)

  const targetSegments = useMemo(() => {
    if (mode === "zone") {
      if (!effectiveZoneId) return []
      return positioned.filter((a) => a.zone_id === effectiveZoneId)
    }
    const lo = Math.min(effectiveFromIdx, effectiveToIdx)
    const hi = Math.max(effectiveFromIdx, effectiveToIdx)
    return positioned.slice(lo, hi + 1)
  }, [mode, effectiveZoneId, effectiveFromIdx, effectiveToIdx, positioned])

  const parsedPattern = useMemo(
    () =>
      bulkLabelPatternSchema.safeParse({
        prefix: prefix.trim(),
        start: parseIntField(startText),
        step: parseIntField(stepText),
        direction,
      }),
    [prefix, startText, stepText, direction],
  )

  const preview = useMemo(() => {
    if (!parsedPattern.success || targetSegments.length === 0) return []
    return buildBulkLabelPreview(
      targetSegments.map((a) => a.id),
      parsedPattern.data,
    )
  }, [parsedPattern, targetSegments])

  // "Other" assets' custom labels — the batch is compared against everything
  // it is NOT about to relabel, mirroring the DB's per-rink case-insensitive
  // unique index on custom_label.
  const otherLabelsLower = useMemo(() => {
    const selectedIds = new Set(targetSegments.map((a) => a.id))
    const set = new Set<string>()
    for (const a of assets) {
      if (selectedIds.has(a.id)) continue
      if (a.custom_label) set.add(a.custom_label.toLowerCase())
    }
    return set
  }, [assets, targetSegments])

  const duplicates = useMemo(
    () =>
      new Set(
        findDuplicateLabels(preview, otherLabelsLower).map((s) =>
          s.toLowerCase(),
        ),
      ),
    [preview, otherLabelsLower],
  )

  const byId = useMemo(
    () => new Map(targetSegments.map((a) => [a.id, a])),
    [targetSegments],
  )

  const canApply =
    parsedPattern.success && preview.length > 0 && duplicates.size === 0

  function onApply() {
    if (!canApply) {
      toast.error(
        duplicates.size > 0
          ? "Resolve the duplicate labels before applying."
          : "Fix the label pattern and select at least one segment first.",
      )
      return
    }
    start(async () => {
      const r = await applyBulkLabels(rink.id, preview)
      if (!r.ok) toast.error(r.error)
      else toast.success(`${preview.length} label(s) applied.`)
    })
  }

  return (
    <Card className="gap-4 py-5">
      <CardHeader>
        <CardTitle>Bulk labeling</CardTitle>
        <CardDescription>
          Relabel a whole zone or a contiguous run of segments in one pass —
          e.g. every panel in Home Bench as HB1, HB2, HB3. Individual segments
          can still be overridden afterward in the list below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Target</Label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={mode === "zone" ? "default" : "outline"}
                onClick={() => setMode("zone")}
              >
                Zone
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "range" ? "default" : "outline"}
                onClick={() => setMode("range")}
              >
                Position range
              </Button>
            </div>
          </div>

          {mode === "zone" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-zone">Zone</Label>
              <select
                id="bulk-zone"
                className={SELECT_CLASS}
                value={effectiveZoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                {zones.length === 0 && <option value="">No zones yet</option>}
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bulk-from">From</Label>
                <select
                  id="bulk-from"
                  className={SELECT_CLASS}
                  value={effectiveFromIdx}
                  onChange={(e) => setFromIdx(Number(e.target.value))}
                  aria-label="Range start"
                >
                  {positioned.map((a, i) => (
                    <option key={a.id} value={i}>
                      {a.custom_label ?? a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bulk-to">To</Label>
                <select
                  id="bulk-to"
                  className={SELECT_CLASS}
                  value={effectiveToIdx}
                  onChange={(e) => setToIdx(Number(e.target.value))}
                  aria-label="Range end"
                >
                  {positioned.map((a, i) => (
                    <option key={a.id} value={i}>
                      {a.custom_label ?? a.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-prefix">Prefix</Label>
            <Input
              id="bulk-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="e.g. HB"
              className="h-9 w-24 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-start">Start</Label>
            <Input
              id="bulk-start"
              inputMode="numeric"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              className="h-9 w-20 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-step">Step</Label>
            <Input
              id="bulk-step"
              inputMode="numeric"
              value={stepText}
              onChange={(e) => setStepText(e.target.value)}
              className="h-9 w-20 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-direction">Direction</Label>
            <select
              id="bulk-direction"
              className={SELECT_CLASS}
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as BulkLabelDirection)
              }
            >
              <option value="with_sequence">With sequence order</option>
              <option value="against_sequence">Against sequence order</option>
            </select>
          </div>
        </div>

        {targetSegments.length > 0 && !parsedPattern.success && (
          <p className="text-destructive text-sm">
            Enter a prefix (up to 12 characters), a start number (0–9999), and
            a step (1–10).
          </p>
        )}

        {preview.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">
                    Permanent label
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    Current label
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    New label
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((entry) => {
                  const asset = byId.get(entry.assetId)
                  const isDup = duplicates.has(entry.customLabel.toLowerCase())
                  return (
                    <tr
                      key={entry.assetId}
                      className={cn(
                        "border-t border-border",
                        isDup &&
                          "bg-destructive-soft text-destructive-soft-foreground",
                      )}
                    >
                      <td className="px-3 py-1.5 font-mono">
                        {asset?.label ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {asset?.custom_label ?? asset?.label ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 font-mono font-semibold">
                        {entry.customLabel}
                        {isDup && (
                          <span className="ml-2 font-sans text-xs font-normal">
                            already in use
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <Button onClick={onApply} disabled={!canApply || pending}>
          {pending
            ? "Applying…"
            : `Apply to ${preview.length} segment${preview.length === 1 ? "" : "s"}`}
        </Button>
      </CardContent>
    </Card>
  )
}
