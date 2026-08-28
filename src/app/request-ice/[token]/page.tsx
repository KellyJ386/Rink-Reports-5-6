import type { Metadata } from "next"

import { resolvePublicToken, touchTokenLastSeen } from "@/lib/rink-scheduling/public-tokens"
import { createAdminClient } from "@/lib/supabase/admin"
import { dayKeyInTz } from "@/lib/timezone"

import { RequestIceForm } from "./_components/request-form"

// ---------------------------------------------------------------------------
// Public booking-request form.
//
// Unauthenticated by design, like /display/[token]: the URL's 256-bit token IS
// the credential, and src/proxy.ts protects only /admin, /reports and
// /dashboard. The token is resolved server-side with the admin client
// (rink_booking_requests grants anon nothing); an unknown, revoked or
// wrong-type token renders one indistinguishable neutral state, never a
// redirect that would confirm a guess. The form itself POSTs to
// /api/rink-booking-requests, where the token is validated again — this page
// only decides what to render.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Request Ice Time",
  // A tokened public URL must never be indexed.
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = "force-dynamic"

/** Clock read outside the component body — React's purity rule flags a direct
 *  call during render (same idiom as the staff pages). */
function nowDate(): Date {
  return new Date()
}

function NotActive() {
  return (
    <main className="bg-background text-foreground flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-16">
        <div className="bg-card flex flex-col gap-2 rounded-xl border p-6">
          <h1 className="text-lg font-semibold tracking-tight">
            This link isn&apos;t active
          </h1>
          <p className="text-muted-foreground text-sm">
            The ice-request form you followed is not available. Check with the
            facility for a current link.
          </p>
        </div>
      </div>
    </main>
  )
}

export default async function RequestIcePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // createAdminClient throws on a misconfigured service key; a public surface
  // should degrade to the same neutral state, not a 500.
  let resolved
  let admin
  try {
    admin = createAdminClient()
    resolved = await resolvePublicToken(admin, token, "request_form")
  } catch {
    return <NotActive />
  }
  if (!resolved) return <NotActive />

  const [{ data: facility }, { data: rinks }] = await Promise.all([
    admin
      .from("facilities")
      .select("name, timezone")
      .eq("id", resolved.facilityId)
      .maybeSingle(),
    admin
      .from("facility_rinks")
      .select("id, name")
      .eq("facility_id", resolved.facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])
  if (!facility) return <NotActive />

  const now = nowDate()
  await touchTokenLastSeen(admin, resolved, now.getTime())

  // "Today" for the date input's floor is the FACILITY's today, not the
  // server's — the API refuses past dates by the same facility-local calendar.
  const todayKey = dayKeyInTz(now, facility.timezone)

  return (
    <main className="bg-background text-foreground flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Ice time request
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Request ice time — {facility.name}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Tell us who you are and when you would like the ice. The rink
            reviews every request and will get back to you by email.
          </p>
        </header>

        <RequestIceForm
          token={token}
          rinks={rinks ?? []}
          todayKey={todayKey}
        />
      </div>
    </main>
  )
}
