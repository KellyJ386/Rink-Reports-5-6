import type { ReactNode } from "react"

import { AppSidebar } from "@/components/app/sidebar"
import { AppHeader } from "@/components/app/header"
import { ReportPageHeader } from "@/components/app/report-page-header"
import { PreviewBanner } from "@/components/preview-banner"
import { Toaster } from "@/components/ui/sonner"
import { OfflineBanner } from "@/components/offline/offline-banner"
import { getIsAdmin, requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { getCurrentTempForFacility } from "@/lib/weather/current-temp"

export default async function ReportsLayout({
  children,
}: {
  children: ReactNode
}) {
  const current = await requireUser()
  const profile = current.profile
  const email = profile?.email ?? current.authUser.email ?? null
  const fullName = profile?.full_name ?? null
  const isAdmin = await getIsAdmin(current)

  let temp: Awaited<ReturnType<typeof getCurrentTempForFacility>> = null
  if (profile?.facility_id) {
    const supabase = await createClient()
    const { data: facility } = await supabase
      .from("facilities")
      .select("city, state, zip_code")
      .eq("id", profile.facility_id)
      .maybeSingle()
    if (facility) {
      temp = await getCurrentTempForFacility(facility)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar isAdmin={isAdmin} email={email} fullName={fullName} />
      <div className="flex min-h-screen flex-col lg:pl-64 xl:pl-72">
        <PreviewBanner />
        <OfflineBanner />
        <AppHeader email={email} fullName={fullName} isAdmin={isAdmin} />
        <ReportPageHeader
          userName={fullName ?? email ?? "Unknown user"}
          tempF={temp?.tempF ?? null}
          tempLocation={temp?.location ?? null}
        />
        <main id="main-content" className="flex-1 2xl:mx-auto 2xl:w-full 2xl:max-w-screen-2xl">{children}</main>
      </div>
      <Toaster />
    </div>
  )
}
