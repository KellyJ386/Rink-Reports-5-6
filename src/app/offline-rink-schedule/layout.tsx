import type { ReactNode } from "react"

// Minimal, DATA-FREE layout (deliberately outside the /reports tree, whose
// layout renders the user's name/email). The service worker caches this
// route's shell for offline use, so its server HTML must contain no user data;
// all booking data is loaded client-side from the per-user IndexedDB cache.
export default function OfflineRinkScheduleLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="bg-background min-h-screen">
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-6 pb-12"
      >
        {children}
      </main>
    </div>
  )
}
