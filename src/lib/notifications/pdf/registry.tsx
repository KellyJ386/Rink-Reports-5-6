import "server-only"

import type { DocumentProps } from "@react-pdf/renderer"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ReactElement } from "react"

/**
 * What a per-module template returns. The cron route uses `facility_id` to
 * verify the rendered record actually lives in the outbox row's facility
 * (defence-in-depth against C2-class bugs).
 *
 * `document` is typed as a <Document> ReactElement so renderToBuffer can
 * consume it without an extra cast.
 */
export type ModulePdfResult = {
  facility_id: string
  document: ReactElement<DocumentProps>
}

export type ModulePdfRenderer = (
  sb: SupabaseClient,
  recordId: string,
) => Promise<ModulePdfResult | null>

// Built up incrementally — one module per commit. Modules not present
// here fall back to the generic SubmissionPdf template in render.tsx.
const REGISTRY: Record<string, ModulePdfRenderer | undefined> = {}

export function registerModulePdfRenderer(
  sourceModule: string,
  renderer: ModulePdfRenderer,
) {
  REGISTRY[sourceModule] = renderer
}

export function getModulePdfRenderer(
  sourceModule: string,
): ModulePdfRenderer | undefined {
  return REGISTRY[sourceModule]
}

// -----------------------------------------------------------------------------
// Eager imports so the registry is populated on module load. New modules:
// add the import + register call here.
// -----------------------------------------------------------------------------
import { renderAccidentReportPdf } from "./templates/accident"
import { renderDailyReportPdf } from "./templates/daily"
import { renderIceDepthPdf } from "./templates/ice-depth"
import { renderIncidentReportPdf } from "./templates/incident"
registerModulePdfRenderer("accident_reports", renderAccidentReportPdf)
registerModulePdfRenderer("daily_reports", renderDailyReportPdf)
registerModulePdfRenderer("ice_depth", renderIceDepthPdf)
registerModulePdfRenderer("incident_reports", renderIncidentReportPdf)
