import Link from "next/link"

import { OfflineFormsView } from "../reports/daily/forms/_components/offline-forms-view"

// Static, data-free shell. No server data fetch and no auth gate at render
// time — the client component reads the signed-in user's own cached report
// forms + today's instances from the per-user IndexedDB cache (written by the
// live /reports/daily/forms board) and queues offline writes through the
// service worker. Being data-free is what makes it safe for the service
// worker to cache for offline navigation on a shared device. Mirrors
// /offline-daily.
export const metadata = { title: "Offline report forms | MFO / Rink Reports" }

const DISPLAY_FONT =
  "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

export default function OfflineFormsPage() {
  return (
    <>
      <div>
        <p className="mb-3 text-xs text-muted-foreground">
          <Link
            href="/reports/daily/forms"
            className="text-muted-foreground no-underline hover:underline"
          >
            ← Report Forms
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
          Report Forms
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Today&apos;s custom reports, available even without a connection.
        </p>
      </div>

      <OfflineFormsView />
    </>
  )
}
