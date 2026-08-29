import { MODULE_LABELS } from "@/lib/modules/module-keys"

import type { ReportPeriod } from "../_lib/get-report"
import type { ReportModuleKey } from "../_lib/modules"

/**
 * A plain GET form — checking/unchecking a module resubmits the page with an
 * updated `modules` param. No client JS; progressive-enhancement friendly,
 * matching the rest of this page's Link-driven controls.
 */
export function ModulePicker({
  availableModules,
  selectedModules,
  period,
  anchor,
}: {
  availableModules: ReportModuleKey[]
  selectedModules: ReportModuleKey[]
  period: ReportPeriod
  anchor: string
}) {
  const selected = new Set(selectedModules)
  return (
    <form method="get" action="/insights" className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="anchor" value={anchor} />
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">Modules</legend>
        {availableModules.map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name="modules"
              value={key}
              defaultChecked={selected.has(key)}
              className="size-4 rounded border-border accent-primary"
            />
            {MODULE_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
      >
        Apply
      </button>
    </form>
  )
}
