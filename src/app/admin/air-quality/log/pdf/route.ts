import { requireAdmin, requireModuleAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { buildAirQualityLogPdf } from "../_lib/log-pdf"
import { resolveLogRange } from "../_lib/log-range"

export const dynamic = "force-dynamic"
// Bound PDF generation time; the span + row caps in log-range/log-pdf keep the
// work under this even on a facility with a long history.
export const maxDuration = 60

// On-demand inspector-ready PDF of the Air Quality monitoring log for a date
// range. Admin-gated; the RLS-scoped server client keeps facility isolation, so
// a caller only ever renders their own facility's readings.
export async function GET(req: Request) {
  const current = await requireAdmin()
  // Report reads gate on module access, which requireAdmin does not imply;
  // without this an admin lacking the grant downloads an empty-but-official
  // looking log instead of being turned away.
  await requireModuleAdmin("air_quality")
  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) {
    return new Response("No facility", { status: 400 })
  }

  const url = new URL(req.url)
  const { from, to } = resolveLogRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  )

  const supabase = await createClient()
  const rendered = await buildAirQualityLogPdf(supabase, facilityId, from, to)
  if (!rendered) {
    return new Response("Not found", { status: 404 })
  }

  return new Response(new Uint8Array(rendered.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${rendered.filename}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
