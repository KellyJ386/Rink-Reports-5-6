import { NextRequest, NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { authorizeExport } from "@/lib/exports/authorize"
import { buildExport, type BuildExportInput } from "@/lib/exports/build-export"

// PDF rendering needs the Node runtime; force dynamic so cookies/env resolve
// per request rather than at build. maxDuration caps render cost for large
// ranges (the builder also hard-caps rows + range span).
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * GET /api/exports?module=<name>&format=csv|pdf&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Streams a CSV or PDF export of one module's submissions for the caller's
 * facility. Security is layered and fails closed:
 *   - requireAdmin() (redirects unauthenticated/non-admin)
 *   - authorizeExport() verifies module + the `view` action on it
 *   - buildExport() pins every query to the caller's own facility_id
 */
export async function GET(request: NextRequest) {
  // requireAdmin redirects on failure; for a fetch/download that surfaces as a
  // redirect response, which is acceptable for this admin-only endpoint.
  const current = await requireAdmin()
  const profile = current.profile

  const params = request.nextUrl.searchParams
  const moduleName = params.get("module") ?? ""
  const format = (params.get("format") ?? "csv") as BuildExportInput["format"]
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""

  const auth = await authorizeExport({
    module: moduleName,
    facilityId: profile?.facility_id ?? null,
    isSuperAdmin: profile?.is_super_admin ?? false,
  })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const result = await buildExport(supabase, auth.facilityId, {
    module: moduleName,
    format,
    from,
    to,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const { bytes, filename, contentType } = result.file
  // RFC 6266 encoding. The filename is already ASCII-safe today (slug() strips
  // to [a-z0-9_] and the dates are validated), but encode defensively so a
  // future filename source can never inject CRLF / extra headers, and provide
  // a UTF-8 form for non-ASCII. encodeURIComponent also covers the ASCII
  // fallback's quote/control chars.
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  const encodedName = encodeURIComponent(filename)
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  })
}
