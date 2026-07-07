import type { ReactNode } from "react"

import { Sidebar } from "@/components/admin/sidebar"
import { GlobalHeader } from "@/components/app/global-header"
import { PreviewBanner } from "@/components/preview-banner"
import { Toaster } from "@/components/ui/sonner"
import { requireAdmin } from "@/lib/auth"
import { getHeaderContext } from "@/lib/header/context"

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const { authUser, profile } = await requireAdmin()
  const email = authUser.email ?? profile?.email ?? null
  const fullName = profile?.full_name ?? null
  const { facilityName, tempF, tempLocation } = await getHeaderContext(
    profile?.facility_id,
  )

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <Sidebar email={email} fullName={fullName} />
      <div className="flex min-h-screen flex-col lg:pl-64 xl:pl-72">
        <PreviewBanner />
        <GlobalHeader
          variant="admin"
          email={email}
          fullName={fullName}
          facilityName={facilityName}
          tempF={tempF}
          tempLocation={tempLocation}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 outline-none 2xl:mx-auto 2xl:w-full 2xl:max-w-screen-2xl"
        >
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  )
}
