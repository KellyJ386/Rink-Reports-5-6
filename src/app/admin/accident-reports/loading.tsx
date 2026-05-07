import { TABS } from "./types"

export default function Loading() {
  const skeletonRows = Array.from({ length: 6 })

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Accident Reports Admin
        </h1>
        <p className="text-muted-foreground text-sm">
          Review submitted accident reports, manage dropdown values, and edit
          Workers&apos; Compensation instructions.
        </p>
      </div>

      <nav
        aria-hidden
        className="flex flex-wrap items-center gap-1 rounded-md border p-1"
      >
        {TABS.map((t) => (
          <span
            key={t.key}
            className="bg-muted/40 inline-block rounded px-3 py-1.5 text-sm font-medium"
          >
            {t.label}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-end gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="bg-muted h-3 w-20 animate-pulse rounded" />
            <div className="bg-muted h-9 w-40 animate-pulse rounded-md" />
          </div>
        ))}
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr>
              {Array.from({ length: 6 }).map((_, i) => (
                <th key={i} className="border-b px-3 py-2 text-left font-medium">
                  <div className="bg-muted h-4 w-24 animate-pulse rounded" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skeletonRows.map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 6 }).map((__, j) => (
                  <td key={j} className="border-b px-3 py-2">
                    <div className="bg-muted h-4 w-full max-w-32 animate-pulse rounded" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
