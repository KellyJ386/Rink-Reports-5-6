import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ExportSettingsRow } from "@/app/admin/exports/types"

import { buildCsv } from "./csv"
import { formatExportDate } from "./format-date"
import {
  EXPORT_MAX_RANGE_DAYS,
  buildModuleTable,
  isExportableModule,
  moduleTitle,
  type DateRange,
} from "./module-config"
import { renderTablePdf } from "./pdf"
import type { ExportFile, ExportFormat } from "./types"

const DAY_MS = 24 * 60 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, "public", any>

/** Default export settings when a facility hasn't saved any yet. */
function defaultSettings(facilityId: string): ExportSettingsRow {
  return {
    id: "",
    facility_id: facilityId,
    logo_url: null,
    header_text: null,
    footer_text: null,
    paper_size: "letter",
    date_format: "MM/DD/YYYY",
    csv_delimiter: "comma",
    include_facility_name: true,
    include_date: true,
    include_submitted_by: true,
    module_column_visibility: {},
    created_at: "",
    updated_at: null,
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export type BuildExportInput = {
  module: string
  format: ExportFormat
  /** Inclusive start date, "YYYY-MM-DD". */
  from: string
  /** Inclusive end date, "YYYY-MM-DD". */
  to: string
}

export type BuildExportResult =
  | { ok: true; file: ExportFile }
  | { ok: false; error: string }

/**
 * Validate the requested window and turn it into an absolute, UTC-bounded
 * range. Rejects malformed dates, reversed ranges, and spans exceeding
 * EXPORT_MAX_RANGE_DAYS so a caller can't trigger an unbounded scan.
 */
function resolveRange(
  from: string,
  to: string,
): { ok: true; range: DateRange } | { ok: false; error: string } {
  if (!DATE_ONLY_RE.test(from) || !DATE_ONLY_RE.test(to)) {
    return { ok: false, error: "Dates must be in YYYY-MM-DD format." }
  }
  const fromMs = Date.parse(`${from}T00:00:00.000Z`)
  const toMs = Date.parse(`${to}T23:59:59.999Z`)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { ok: false, error: "Invalid date range." }
  }
  if (toMs < fromMs) {
    return { ok: false, error: "End date must be on or after the start date." }
  }
  if (toMs - fromMs > EXPORT_MAX_RANGE_DAYS * DAY_MS) {
    return {
      ok: false,
      error: `Date range is too large. Limit exports to ${EXPORT_MAX_RANGE_DAYS} days.`,
    }
  }
  return {
    ok: true,
    range: {
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toMs).toISOString(),
    },
  }
}

/** Filename-safe slug for a module + date range. */
function slug(module: string): string {
  return module.replace(/[^a-z0-9_]/gi, "_").toLowerCase()
}

/**
 * Core export builder. Assumes the CALLER has already authenticated the user
 * (requireAdmin) and verified module permission; this function focuses on
 * validation, facility-scoped data assembly, and serialization. `facilityId`
 * MUST be the caller's own facility — every query inside is pinned to it, so
 * cross-facility data can never surface even if a bad module/range is passed.
 */
export async function buildExport(
  sb: Sb,
  facilityId: string,
  input: BuildExportInput,
): Promise<BuildExportResult> {
  if (!isExportableModule(input.module)) {
    return { ok: false, error: "Unknown or non-exportable module." }
  }
  if (input.format !== "csv" && input.format !== "pdf") {
    return { ok: false, error: "Unsupported format." }
  }

  const ranged = resolveRange(input.from, input.to)
  if (!ranged.ok) return { ok: false, error: ranged.error }

  // Load facility export settings (branding, delimiter, date format, column
  // visibility). Pinned to facility; falls back to defaults when unset.
  const { data: settingsRow } = await sb
    .from("export_settings")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle()
  const settings = (settingsRow as ExportSettingsRow | null) ?? defaultSettings(facilityId)

  const table = await buildModuleTable({
    sb,
    facilityId,
    range: ranged.range,
    settings,
    module: input.module,
  })
  if (!table) {
    return { ok: false, error: "Could not build export for this module." }
  }

  const base = `${slug(input.module)}_${input.from}_to_${input.to}`

  if (input.format === "csv") {
    return {
      ok: true,
      file: {
        bytes: buildCsv(table, settings.csv_delimiter),
        filename: `${base}.csv`,
        contentType: "text/csv; charset=utf-8",
      },
    }
  }

  const rangeLabel = `${formatExportDate(`${input.from}T00:00:00Z`, settings.date_format, false)} – ${formatExportDate(`${input.to}T00:00:00Z`, settings.date_format, false)}`
  const pdf = await renderTablePdf(table, settings, rangeLabel)
  return {
    ok: true,
    file: {
      bytes: pdf,
      filename: `${base}.pdf`,
      contentType: "application/pdf",
    },
  }
}

export { moduleTitle }
