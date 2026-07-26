import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { renderPdfForModule } from "@/lib/notifications/pdf/render"

export const dynamic = "force-dynamic"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// On-demand download of the dasher-boards walk PDF. Reuses the exact same
// @react-pdf template the notification dispatch pipeline renders
// (renderPdfForModule → dasher_boards registry entry). The inspection id is
// the only client input; the user's RLS-scoped server client keeps facility
// isolation, so a caller can only render walks in their own facility.
export async function GET(req: Request) {
  await requireUser()

  const id = new URL(req.url).searchParams.get("id")
  if (!id || !UUID_RE.test(id)) {
    return new Response("Not found", { status: 404 })
  }

  const supabase = await createClient()

  // Explicit permission gate: fail closed independent of RLS. A user without
  // dasher_boards view access cannot render the PDF even if RLS regressed.
  if (!(await currentUserCan(supabase, "dasher_boards", "view"))) {
    return new Response("Forbidden", { status: 403 })
  }

  const rendered = await renderPdfForModule(supabase, "dasher_boards", id)
  if (!rendered) {
    return new Response("Not found", { status: 404 })
  }

  return new Response(new Uint8Array(rendered.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="dasher-boards-report.pdf"',
      "Cache-Control": "private, no-store",
    },
  })
}
