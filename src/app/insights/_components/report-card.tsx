import { Card, CardContent } from "@/components/ui/card"
import { MODULE_LABELS } from "@/lib/modules/module-keys"
import { MODULE_TEXT } from "@/components/ui/module-theme"
import { cn } from "@/lib/utils"

import { formatMetricValue } from "../_lib/format-metric-value"
import type { ReportMetricLabel } from "../_lib/get-report"
import { REPORT_MODULE_THEME_KEY, type ReportModuleKey } from "../_lib/modules"

/**
 * One card per module, metrics rendered from report_metric_definitions
 * labels/units — never hardcoded field lists, so a metric added to a future
 * module shows up here with no UI change.
 */
export function ReportCard({
  moduleKey,
  metrics,
  labels,
}: {
  moduleKey: ReportModuleKey
  metrics: Record<string, unknown> | null
  labels: ReportMetricLabel[]
}) {
  const themeKey = REPORT_MODULE_THEME_KEY[moduleKey]
  const accentText = MODULE_TEXT[themeKey]

  return (
    <Card className="gap-4 py-5">
      <h2 className={cn("px-6 text-lg font-semibold tracking-tight", accentText)}>
        {MODULE_LABELS[moduleKey]}
      </h2>
      <CardContent className="px-6">
        {metrics === null ? (
          <p className="text-sm text-muted-foreground">No activity recorded for this period.</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            {labels.map((def) => (
              <MetricEntry key={def.metricKey} label={def.label} unit={def.unit} value={metrics[def.metricKey]} />
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function MetricEntry({
  label,
  unit,
  value,
}: {
  label: string
  unit: string | null
  value: unknown
}) {
  const formatted = formatMetricValue(value, unit)
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xl font-semibold tracking-tight">
        {formatted.kind === "empty" && <span className="text-muted-foreground">—</span>}
        {formatted.kind === "scalar" && formatted.text}
        {formatted.kind === "list" && (
          <span className="block text-sm font-normal">{formatted.items.join(", ")}</span>
        )}
        {formatted.kind === "breakdown" && (
          <ul className="flex flex-col gap-0.5 text-sm font-normal">
            {formatted.entries.map((entry) => (
              <li key={entry.key} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{entry.key}</span>
                <span className="font-mono">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  )
}
