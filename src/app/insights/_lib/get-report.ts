"use server"

import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { dayKeyInTz } from "@/lib/timezone"

import {
  aggregateModuleMetrics,
  computeCoverage,
  type DailyMetricRow,
  type MetricDefinition,
} from "./combine"
import { isReportModuleKey, type ReportModuleKey } from "./modules"

export type ReportPeriod = "day" | "week" | "month" | "year"

export type GetReportInput = {
  moduleKeys: string[]
  period: ReportPeriod
  /** "YYYY-MM-DD", facility-local. */
  anchorDate: string
}

export type ModuleReport = {
  moduleKey: ReportModuleKey
  /** null when this module has no data at all for the resolved period. */
  metrics: Record<string, unknown> | null
}

export type ReportMetricLabel = {
  metricKey: string
  label: string
  unit: string | null
  sortOrder: number
}

export type GetReportResult =
  | {
      ok: true
      period: ReportPeriod
      anchorDate: string
      startDate: string
      endDate: string
      /** True when this is "today" and was read live rather than from the rollup. */
      isLive: boolean
      modules: ModuleReport[]
      /** metricKey -> label/unit, per requested module, for rendering. */
      labelsByModule: Record<string, ReportMetricLabel[]>
      daysInPeriod: number
      daysWithData: number
      daysMissing: number
    }
  | { ok: false; error: string }

const PERIODS: readonly ReportPeriod[] = ["day", "week", "month", "year"]
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The single read path for the reporting layer, for all four periods.
 *
 * facility_id is ALWAYS resolved from the session (requireUser) — never
 * accepted as an argument here, matching the project's non-negotiable
 * invariant. The 'reports' module permission is enforced in THIS function
 * (currentUserCan), not left to the page's rendering: a caller invoking this
 * action directly, unauthorized, gets an error result, not empty data.
 *
 * period='day' with anchorDate = today (in the facility's OWN timezone) reads
 * LIVE fact tables via compute_live_daily_metrics (migration 268), which
 * dispatches to the exact same compute_daily_metrics_* functions the nightly
 * rollup uses (migration 267) — so a live number and tomorrow's rolled-up
 * number for the same day cannot diverge into two implementations. Every
 * other case aggregates facility_daily_metrics via combine.ts, honoring each
 * metric's registered aggregation mode.
 */
export async function getReport(input: GetReportInput): Promise<GetReportResult> {
  if (!PERIODS.includes(input.period)) {
    return { ok: false, error: `Unknown period "${input.period}".` }
  }
  if (!DATE_ONLY_RE.test(input.anchorDate)) {
    return { ok: false, error: "anchorDate must be in YYYY-MM-DD format." }
  }
  const moduleKeys = input.moduleKeys.filter(isReportModuleKey)
  if (moduleKeys.length === 0) {
    return { ok: false, error: "Select at least one module." }
  }

  const current = await requireUser()
  const facilityId = current.profile?.facility_id
  if (!facilityId) {
    return { ok: false, error: "Your account is not attached to a facility." }
  }

  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "reports", "view"))) {
    return { ok: false, error: "You do not have access to reports." }
  }

  const { data: boundsRows, error: boundsError } = await supabase.rpc("report_period_bounds", {
    p_facility_id: facilityId,
    p_period: input.period,
    p_anchor: input.anchorDate,
  })
  if (boundsError || !boundsRows || boundsRows.length === 0) {
    return { ok: false, error: "Could not resolve the report period." }
  }
  const { start_date: startDate, end_date: endDate } = boundsRows[0]

  const { data: facilityRow } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  const todayLocal = dayKeyInTz(new Date(), facilityRow?.timezone ?? null)

  const isLive = input.period === "day" && input.anchorDate === todayLocal

  const { data: defRows } = await supabase
    .from("report_metric_definitions")
    .select("module_key, metric_key, label, unit, aggregation, sort_order")
    .in("module_key", moduleKeys)
    .order("sort_order", { ascending: true })

  const definitions: MetricDefinition[] = (defRows ?? []).map((d) => ({
    moduleKey: d.module_key,
    metricKey: d.metric_key,
    label: d.label,
    unit: d.unit,
    aggregation: d.aggregation as MetricDefinition["aggregation"],
    sortOrder: d.sort_order,
  }))

  const labelsByModule: Record<string, ReportMetricLabel[]> = {}
  for (const key of moduleKeys) {
    labelsByModule[key] = definitions
      .filter((d) => d.moduleKey === key)
      .map((d) => ({ metricKey: d.metricKey, label: d.label, unit: d.unit, sortOrder: d.sortOrder }))
  }

  if (isLive) {
    const modules: ModuleReport[] = await Promise.all(
      moduleKeys.map(async (moduleKey) => {
        const { data, error } = await supabase.rpc("compute_live_daily_metrics", {
          p_module_key: moduleKey,
          p_business_date: input.anchorDate,
        })
        return { moduleKey, metrics: error ? null : ((data as Record<string, unknown>) ?? null) }
      }),
    )
    return {
      ok: true,
      period: input.period,
      anchorDate: input.anchorDate,
      startDate,
      endDate,
      isLive: true,
      modules,
      labelsByModule,
      // "Today" is never a closed rollup day, so coverage doesn't apply —
      // the live badge on the UI communicates freshness instead.
      daysInPeriod: 0,
      daysWithData: 0,
      daysMissing: 0,
    }
  }

  const { data: metricRows } = await supabase
    .from("facility_daily_metrics")
    .select("business_date, module_key, metrics")
    .eq("facility_id", facilityId)
    .gte("business_date", startDate)
    .lte("business_date", endDate)
    .in("module_key", moduleKeys)

  const rowsByModule = new Map<string, DailyMetricRow[]>()
  const datesWithDataByModule = new Map<string, Set<string>>()
  for (const key of moduleKeys) {
    rowsByModule.set(key, [])
    datesWithDataByModule.set(key, new Set())
  }
  for (const row of metricRows ?? []) {
    const list = rowsByModule.get(row.module_key)
    const dates = datesWithDataByModule.get(row.module_key)
    if (!list || !dates) continue
    list.push({
      businessDate: row.business_date,
      moduleKey: row.module_key,
      metrics: (row.metrics as Record<string, unknown>) ?? {},
    })
    dates.add(row.business_date)
  }

  const modules: ModuleReport[] = moduleKeys.map((moduleKey) => {
    const rows = rowsByModule.get(moduleKey) ?? []
    if (rows.length === 0) return { moduleKey, metrics: null }
    return {
      moduleKey,
      metrics: aggregateModuleMetrics({
        rows,
        definitions: definitions.filter((d) => d.moduleKey === moduleKey),
      }),
    }
  })

  const { daysInPeriod, daysWithData, daysMissing } = computeCoverage({
    startDate,
    endDate,
    today: todayLocal,
    moduleKeys,
    datesWithDataByModule,
  })

  return {
    ok: true,
    period: input.period,
    anchorDate: input.anchorDate,
    startDate,
    endDate,
    isLive: false,
    modules,
    labelsByModule,
    daysInPeriod,
    daysWithData,
    daysMissing,
  }
}

