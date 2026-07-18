import Link from "next/link"

import { OfflineMyAreas } from "../reports/daily/_components/offline-my-areas"

// Static, data-free shell. No server data fetch and no auth gate at render
// time — the client component reads the signed-in user's own resolved areas
// from the per-user IndexedDB cache (and refreshes them over the network when
// online). Being data-free is what makes it safe for the service worker to
// cache for offline navigation on a shared device. Mirrors /offline-schedule.
export const metadata = { title: "Offline areas | MFO / Rink Reports" }

const DISPLAY_FONT =
  "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

export default function OfflineDailyPage() {
  return (
    <>
      <div>
        <p className="mb-3 text-xs text-muted-foreground">
          <Link
            href="/reports/daily"
            className="text-muted-foreground no-underline hover:underline"
          >
            ← Daily Reports
          </Link>
        </p>
        <h1
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "clamp(28px, 6vw, 40px)",
            lineHeight: 1,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            margin: 0,
          }}
          className="text-foreground"
        >
          My Areas
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Today&apos;s area assignments, available even without a connection.
        </p>
      </div>

      <OfflineMyAreas />
    </>
  )
}
