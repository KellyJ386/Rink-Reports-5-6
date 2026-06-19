import Link from "next/link"

import { USARink } from "@/components/ice-depth/usa-rink"
import { rinkCoords, type RinkPointSpec } from "@/components/ice-depth/rink-geometry"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"

import type { DayBucket, PointRollup, AnalyticsSummary } from "../_lib/analytics"

type Colors = { low: string; ok: string; high: string }

type Props = {
  layouts: Array<{ id: string; name: string }>
  selectedLayoutId: string | null
  summary: AnalyticsSummary
  points: PointRollup[]
  trend: DayBucket[]
  colors: Colors
  unit: string
  from: string
  to: string | null
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function severityColor(s: PointRollup["dominantSeverity"], c: Colors): string {
  if (s === "low") return c.low
  if (s === "high") return c.high
  return c.ok
}

function layoutHref(layoutId: string, from: string, to: string | null): string {
  const sp = new URLSearchParams()
  sp.set("tab", "analytics")
  sp.set("layout", layoutId)
  if (from) sp.set("from", from)
  if (to) sp.set("to", to)
  return `/admin/ice-depth?${sp.toString()}`
}

export function AnalyticsTab({
  layouts,
  selectedLayoutId,
  summary,
  points,
  trend,
  colors,
  unit,
  from,
  to,
}: Props) {
  if (layouts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No diagrams yet</CardTitle>
          <CardDescription>
            Create a rink diagram with measurement points before analytics can
            chart depth trends.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Layout picker — analytics are per-diagram. */}
      {layouts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {layouts.map((l) => (
            <Link
              key={l.id}
              href={layoutHref(l.id, from, to)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                l.id === selectedLayoutId
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}

      {summary.measurementCount === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No readings in this window</CardTitle>
            <CardDescription>
              No depth measurements were recorded for this diagram in the
              selected date range.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Sessions" value={summary.sessionCount} />
            <StatCard label="Readings" value={summary.measurementCount} />
            <StatCard
              label={`Avg depth (${unit})`}
              value={summary.avgDepth.toFixed(2)}
            />
            <StatCard
              label="Below min"
              value={pct(summary.lowRate)}
              delta={`${summary.lowCount} readings`}
              deltaTone={summary.lowCount > 0 ? "negative" : "neutral"}
            />
            <StatCard
              label="Above target"
              value={pct(summary.highRate)}
              delta={`${summary.highCount} readings`}
              deltaTone={summary.highCount > 0 ? "negative" : "neutral"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
            {/* Heat map of problem spots */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Problem spots</CardTitle>
                <CardDescription>
                  Each point colored by its most common condition across the
                  window. The number is the point&apos;s average depth.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <div
                  className="w-full max-w-[16rem]"
                  style={{ aspectRatio: "380/740" }}
                >
                  <USARink
                    points={points.map(
                      (p): RinkPointSpec => {
                        const { cx, cy } = rinkCoords(p.x, p.y)
                        return {
                          id: `pt-${p.pointNumber}`,
                          pointNumber: p.pointNumber,
                          cx,
                          cy,
                          state: "done",
                          doneColor: severityColor(p.dominantSeverity, colors),
                          depthValue: p.avg,
                        }
                      },
                    )}
                    showValues
                    className="rounded-xl border"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Per-point table, worst-first */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Per-point breakdown</CardTitle>
                <CardDescription>
                  Sorted by how often each point reads below the minimum.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PointTable points={points} unit={unit} />
              </CardContent>
            </Card>
          </div>

          {/* Daily trend strip */}
          {trend.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily activity</CardTitle>
                <CardDescription>
                  Readings per day; the red segment is below-min, amber is
                  above-target.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TrendStrip trend={trend} colors={colors} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function PointTable({
  points,
  unit,
}: {
  points: PointRollup[]
  unit: string
}) {
  // Worst-first: most-frequently-low, then most-frequently-high.
  const sorted = [...points].sort(
    (a, b) =>
      b.lowRate - a.lowRate ||
      b.highCount - a.highCount ||
      a.pointNumber - b.pointNumber,
  )
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">#</th>
            <th className="border-b px-3 py-2 text-left font-medium">Label</th>
            <th className="border-b px-3 py-2 text-right font-medium">Reads</th>
            <th className="border-b px-3 py-2 text-right font-medium">
              Avg ({unit})
            </th>
            <th className="border-b px-3 py-2 text-right font-medium">Min</th>
            <th className="border-b px-3 py-2 text-right font-medium">Max</th>
            <th className="border-b px-3 py-2 text-right font-medium">Low</th>
            <th className="border-b px-3 py-2 text-right font-medium">High</th>
            <th className="border-b px-3 py-2 text-right font-medium">Low %</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.pointNumber} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle font-medium">
                {p.pointNumber}
              </td>
              <td className="text-muted-foreground border-b px-3 py-2 align-middle">
                {p.label ?? "—"}
              </td>
              <td className="border-b px-3 py-2 text-right align-middle tabular-nums">
                {p.count}
              </td>
              <td className="border-b px-3 py-2 text-right align-middle tabular-nums">
                {p.avg.toFixed(2)}
              </td>
              <td className="border-b px-3 py-2 text-right align-middle tabular-nums">
                {p.min.toFixed(2)}
              </td>
              <td className="border-b px-3 py-2 text-right align-middle tabular-nums">
                {p.max.toFixed(2)}
              </td>
              <td className="border-b px-3 py-2 text-right align-middle">
                <Badge variant={p.lowCount > 0 ? "error" : "secondary"}>
                  {p.lowCount}
                </Badge>
              </td>
              <td className="border-b px-3 py-2 text-right align-middle">
                <Badge variant={p.highCount > 0 ? "warning" : "secondary"}>
                  {p.highCount}
                </Badge>
              </td>
              <td className="border-b px-3 py-2 text-right align-middle tabular-nums">
                {pct(p.lowRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TrendStrip({ trend, colors }: { trend: DayBucket[]; colors: Colors }) {
  const maxTotal = Math.max(1, ...trend.map((d) => d.totalMeasurements))
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 140 }}>
      {trend.map((d) => {
        const okCount = Math.max(0, d.totalMeasurements - d.lowCount - d.highCount)
        const h = (n: number) => `${(n / maxTotal) * 110}px`
        return (
          <div
            key={d.date}
            className="flex min-w-7 flex-1 flex-col items-center gap-1"
            title={`${d.date}: ${d.sessions} session(s), ${d.totalMeasurements} reading(s), ${d.lowCount} low, ${d.highCount} high`}
          >
            <div className="flex w-5 flex-col-reverse overflow-hidden rounded-sm">
              {d.lowCount > 0 && (
                <div style={{ height: h(d.lowCount), background: colors.low }} />
              )}
              {d.highCount > 0 && (
                <div style={{ height: h(d.highCount), background: colors.high }} />
              )}
              {okCount > 0 && (
                <div
                  style={{ height: h(okCount) }}
                  className="bg-muted-foreground/30"
                />
              )}
            </div>
            <span className="text-muted-foreground text-[9px] tabular-nums">
              {d.date.slice(5)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
