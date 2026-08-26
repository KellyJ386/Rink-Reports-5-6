import Link from "next/link"

import { OfflineRinkSchedule } from "../reports/rink-scheduling/_components/offline-rink-schedule"

// Static, data-free shell. No server data fetch and no auth gate at render
// time — the client component reads the signed-in user's cached calendar from
// per-user IndexedDB. Being data-free is what makes it safe for the service
// worker to cache for offline navigation on a shared device.
export const metadata = { title: "Offline rink schedule | MFO / Rink Reports" }

export default function OfflineRinkSchedulePage() {
  return (
    <>
      <p className="text-muted-foreground mb-3 text-xs">
        <Link
          href="/reports/rink-scheduling"
          className="text-muted-foreground no-underline hover:underline"
        >
          ← Rink schedule
        </Link>
      </p>
      <OfflineRinkSchedule />
    </>
  )
}
