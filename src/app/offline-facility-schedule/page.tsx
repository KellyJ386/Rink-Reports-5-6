import Link from "next/link"

import { OfflineFacilitySchedule } from "../reports/facility-scheduling/_components/offline-facility-schedule"

// Static, data-free shell. No server data fetch and no auth gate at render
// time — the client component reads the signed-in user's cached calendar from
// per-user IndexedDB. Being data-free is what makes it safe for the service
// worker to cache for offline navigation on a shared device.
export const metadata = { title: "Offline facility schedule | MFO / Rink Reports" }

export default function OfflineFacilitySchedulePage() {
  return (
    <>
      <p className="text-muted-foreground mb-3 text-xs">
        <Link
          href="/reports/facility-scheduling"
          className="text-muted-foreground no-underline hover:underline"
        >
          ← Facility schedule
        </Link>
      </p>
      <OfflineFacilitySchedule />
    </>
  )
}
