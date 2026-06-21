import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { renderPdfForModule } from "@/lib/notifications/pdf/render"

export const dynamic = "force-dynamic"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// On-demand download of the ice-depth session PDF. Reuses the exact same
// @react-pdf template the notification dispatch pipeline renders
// (renderPdfForModule → ice_depth registry entry). The session id is the only
// client input; the user's RLS-scoped server client keeps facility isolation,
// so a caller can only render sessions in their own facility.
export async function GET(req: Request) {
  await requireUser()

  const id = new URL(req.url).searchParams.get("id")
  if (!id || !UUID_RE.test(id)) {
    return new Response("Not found", { status: 404 })
  }

  const supabase = await createClient()
  const rendered = await renderPdfForModule(supabase, "ice_depth", id)
  if (!rendered) {
    return new Response("Not found", { status: 404 })
  }

  return new Response(new Uint8Array(rendered.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="ice-depth-report.pdf"',
      "Cache-Control": "private, no-store",
    },
  })
}
