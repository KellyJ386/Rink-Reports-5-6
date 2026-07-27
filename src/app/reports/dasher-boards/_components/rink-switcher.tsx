"use client"

// Header rink switcher: a plain <select> over the active rinks. Changing it
// navigates to that rink's slug route, so deep links / bookmarks and the
// switcher share one canonical URL per rink.

import { useRouter } from "next/navigation"

export function RinkSwitcher({
  rinks,
  currentSlug,
}: {
  rinks: Array<{ slug: string; name: string }>
  currentSlug: string
}) {
  const router = useRouter()
  if (rinks.length <= 1) return null
  return (
    <select
      aria-label="Rink"
      className="border-input bg-background h-10 rounded-md border px-3 py-1 text-sm"
      value={currentSlug}
      onChange={(e) =>
        router.push(`/reports/dasher-boards/${encodeURIComponent(e.target.value)}`)
      }
    >
      {rinks.map((r) => (
        <option key={r.slug} value={r.slug}>
          {r.name}
        </option>
      ))}
    </select>
  )
}
