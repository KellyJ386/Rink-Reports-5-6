import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { getEnabledModuleKeys } from "@/lib/modules/facility-modules"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { dayKeyInTz } from "@/lib/timezone"

import { CoverageBanner } from "./_components/coverage-banner"
import { DateNav } from "./_components/date-nav"
import { ExportButton } from "./_components/export-button"
import { ModulePicker } from "./_components/module-picker"
import { NotAvailable } from "./_components/not-available"
import { PeriodSelector } from "./_components/period-selector"
import { ReportCard } from "./_components/report-card"
import { getReport, type ReportPeriod } from "./_lib/get-report"
import { isReportModuleKey, REPORT_MODULE_KEYS, type ReportModuleKey } from "./_lib/modules"

export const dynamic = "force-dynamic"

export const metadata = { title: "Insights | RinkReports" }

type SearchParams = Promise<{ period?: string; anchor?: string; modules?: string }>

const PERIODS: readonly ReportPeriod[] = ["day", "week", "month", "year"]

function parsePeriod(value: string | undefined): ReportPeriod {
  return PERIODS.includes(value as ReportPeriod) ? (value as ReportPeriod) : "day"
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const current = await requireUser()

  if (!current.profile?.facility_id) {
    return <NotAvailable reason="no-facility" />
  }
  const facilityId = current.profile.facility_id

  const supabase = await createClient()

  // Independent, page-level gate — getReport() enforces this too, but a
  // denied user should see a real explanation, not a page that renders empty
  // cards because every module call failed silently.
  if (!(await currentUserCan(supabase, "reports", "view"))) {
    return <NotAvailable />
  }
  // Exporting is a higher-trust action than reading on screen — a document
  // that leaves the building — so it needs 'edit', not just 'view'.
  const canExport = await currentUserCan(supabase, "reports", "edit")

  const { data: facilityRow } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  const todayAnchor = dayKeyInTz(new Date(), facilityRow?.timezone ?? null)

  const period = parsePeriod(params.period)
  const anchor = params.anchor && DATE_ONLY_RE.test(params.anchor) ? params.anchor : todayAnchor

  const enabledModuleKeys = await getEnabledModuleKeys(facilityId)
  const availableModules: ReportModuleKey[] = REPORT_MODULE_KEYS.filter(
    (key) => enabledModuleKeys === null || enabledModuleKeys.includes(key),
  )

  const requestedModules = params.modules
    ? params.modules.split(",").filter(isReportModuleKey).filter((k) => availableModules.includes(k))
    : availableModules
  const selectedModules = requestedModules.length > 0 ? requestedModules : availableModules

  const result =
    selectedModules.length > 0
      ? await getReport({ moduleKeys: selectedModules, period, anchorDate: anchor })
      : null

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        eyebrow="Reporting"
        title="Insights"
        description="Facility-wide compliance and activity reporting, aggregated across every module."
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <PeriodSelector period={period} anchor={anchor} modules={selectedModules} />
        {result?.ok && (
          <DateNav
            period={period}
            anchor={anchor}
            startDate={result.startDate}
            endDate={result.endDate}
            todayAnchor={todayAnchor}
            modules={selectedModules}
          />
        )}
        {result?.ok && canExport && (
          <ExportButton moduleKeys={selectedModules} period={period} anchorDate={anchor} />
        )}
      </div>

      <ModulePicker
        availableModules={availableModules}
        selectedModules={selectedModules}
        period={period}
        anchor={anchor}
      />

      {availableModules.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No modules are enabled for this facility yet. An administrator can turn them on from Admin
          Center → Modules.
        </p>
      )}

      {result && !result.ok && (
        <p className="text-sm text-destructive">{result.error}</p>
      )}

      {result?.ok && (
        <>
          {result.isLive && (
            <p className="text-sm text-muted-foreground">
              Showing live numbers for today — tonight&apos;s rollup has not run yet.
            </p>
          )}
          <CoverageBanner
            daysInPeriod={result.daysInPeriod}
            daysWithData={result.daysWithData}
            daysMissing={result.daysMissing}
          />
          {result.modules.every((m) => m.metrics === null) ? (
            <p className="text-sm text-muted-foreground">No activity recorded for this period.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {result.modules.map((m) => (
                <ReportCard
                  key={m.moduleKey}
                  moduleKey={m.moduleKey}
                  metrics={m.metrics}
                  labels={result.labelsByModule[m.moduleKey] ?? []}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
