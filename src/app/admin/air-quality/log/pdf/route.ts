import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { buildAirQualityLogPdf } from "../_lib/log-pdf"

export const dynamic = "force-dynamic"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// On-demand inspector-ready PDF of the Air Quality monitoring log for a date
// range. Admin-gated; the RLS-scoped server client keeps facility isolation, so
// a caller only ever renders their own facility's readings.
export async function GET(req: Request) {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null
  if (!facilityId) {
    return new Response("No facility", { status: 400 })
  }

  const url = new URL(req.url)
  const toParam = url.searchParams.get("to")
  const fromParam = url.searchParams.get("from")
  const to = toParam && DATE_RE.test(toParam) ? toParam : isoDate(new Date())
  const from =
    fromParam && DATE_RE.test(fromParam)
      ? fromParam
      : isoDate(new Date(Date.now() - 90 * DAY_MS))

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
