import type { ReactNode } from "react"

import { AppSidebar } from "@/components/app/sidebar"
import { AppBottomTabBar } from "@/components/app/bottom-tab-bar"
import { GlobalHeader } from "@/components/app/global-header"
import { Toaster } from "@/components/ui/sonner"
import { getIsAdmin, requireUser } from "@/lib/auth"
import { getHeaderContext } from "@/lib/header/context"
import { getEnabledModuleKeys } from "@/lib/modules/facility-modules"
import { getCommunicationsUnreadCount } from "@/lib/communications/unread"

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const current = await requireUser()
  const profile = current.profile
  const email = profile?.email ?? current.authUser.email ?? null
  const fullName = profile?.full_name ?? null
  const isAdmin = await getIsAdmin(current)
  const enabledModules = await getEnabledModuleKeys(profile?.facility_id)
  const communicationsUnread = await getCommunicationsUnreadCount(
    profile?.facility_id,
  )
  const badgeCounts = { communications: communicationsUnread }
  const { facilityName, tempF, tempLocation } = await getHeaderContext(
    profile?.facility_id,
  )

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        isAdmin={isAdmin}
        email={email}
        fullName={fullName}
        enabledModules={enabledModules}
        badgeCounts={badgeCounts}
      />
      <div className="flex min-h-screen flex-col lg:pl-64 xl:pl-72">
        <GlobalHeader
          variant="staff"
          email={email}
          fullName={fullName}
          facilityName={facilityName}
          tempF={tempF}
          tempLocation={tempLocation}
        />
        <main id="main-content" className="flex-1 pb-20 2xl:mx-auto 2xl:w-full 2xl:max-w-screen-2xl lg:pb-0">{children}</main>
      </div>
      <AppBottomTabBar
        isAdmin={isAdmin}
        email={email}
        fullName={fullName}
        enabledModules={enabledModules}
        badgeCounts={badgeCounts}
      />
      <Toaster />
    </div>
  )
}
