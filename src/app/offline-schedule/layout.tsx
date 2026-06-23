import type { ReactNode } from "react"

// Minimal, DATA-FREE layout (deliberately outside the /reports tree, whose
// layout renders the user's name/email). The service worker caches this
// route's shell for offline use, so its server HTML must contain no user data;
// all shift data is loaded client-side from the per-user IndexedDB cache.
export default function OfflineScheduleLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-[600px] flex-col gap-5 px-4 pt-6 pb-12"
      >
        {children}
      </main>
    </div>
  )
}
