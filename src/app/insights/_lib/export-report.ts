"use server"

import type { ExportSettingsRow } from "@/app/admin/exports/types"
import { requireUser } from "@/lib/auth"
import { defaultExportSettings } from "@/lib/exports/types"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { formatPdfGeneratedAt } from "@/lib/notifications/pdf/format"

import { fetchLogoDataUri } from "./fetch-logo"
import { renderInsightsReportPdf } from "./export-pdf"
import { getReport, type ReportPeriod } from "./get-report"
import { periodLabel } from "./period-label"

export type ExportReportInput = {
  moduleKeys: string[]
  period: ReportPeriod
  anchorDate: string
}

export type ExportReportResult =
  | { ok: true; base64: string; filename: string; contentType: string }
  | { ok: false; error: string }

/**
 * Renders the exact report getReport() would show on screen to a branded PDF.
 * Reuses getReport() rather than recomputing anything — the exported numbers
 * can never drift from what the viewer saw before clicking Export.
 *
 * Gated at 'edit' or higher on the 'reports' module, one tier above the
 * 'view' getReport() itself requires: reading a report on screen is one
 * thing, producing a document that leaves the building is a higher-trust
 * action (CLAUDE.md). A view-tier caller therefore gets a clear error here
 * even though they could see the same numbers on the page.
 */
export async function exportReportPdf(input: ExportReportInput): Promise<ExportReportResult> {
  const current = await requireUser()
  const facilityId = current.profile?.facility_id
  if (!facilityId) {
    return { ok: false, error: "Your account is not attached to a facility." }
  }

  const supabase = await createClient()

  if (!(await currentUserCan(supabase, "reports", "edit"))) {
    return { ok: false, error: "You need edit access to Reports to export a PDF." }
  }

  const report = await getReport(input)
  if (!report.ok) return { ok: false, error: report.error }

  const [{ data: facilityRow }, { data: settingsRow }] = await Promise.all([
    supabase.from("facilities").select("name, timezone").eq("id", facilityId).maybeSingle(),
    supabase.from("export_settings").select("*").eq("facility_id", facilityId).maybeSingle(),
  ])

  const settings = (settingsRow as ExportSettingsRow | null) ?? defaultExportSettings(facilityId)
  const timeZone = facilityRow?.timezone ?? null
  const logoDataUri = await fetchLogoDataUri(settings.logo_url)

  const generatedAtLabel = formatPdfGeneratedAt(new Date(), timeZone)
  const generatedByName = current.profile?.full_name || current.profile?.email || "Unknown user"

  const bytes = await renderInsightsReportPdf({
    facilityName: facilityRow?.name ?? "Facility",
    logoDataUri,
    periodLabel: periodLabel(report.period, report.startDate, report.endDate),
    generatedAtLabel,
    generatedByName,
    isLive: report.isLive,
    daysInPeriod: report.daysInPeriod,
    daysWithData: report.daysWithData,
    daysMissing: report.daysMissing,
    modules: report.modules.map((m) => ({
      moduleKey: m.moduleKey,
      metrics: m.metrics,
      labels: report.labelsByModule[m.moduleKey] ?? [],
    })),
    settings,
  })

  return {
    ok: true,
    base64: bytes.toString("base64"),
    filename: `insights-${report.period}-${report.anchorDate}.pdf`,
    contentType: "application/pdf",
  }
}
