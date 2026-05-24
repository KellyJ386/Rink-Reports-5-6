export default function Loading() {
  const skeletonRows = Array.from({ length: 8 })
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Module Access Control
        </h1>
        <p className="text-muted-foreground text-sm">
          Loading users&hellip;
        </p>
      </div>
      <ul className="divide-y divide-slate-800 rounded-md border border-slate-700">
        {skeletonRows.map((_, i) => (
          <li key={i} className="px-4 py-3">
            <div className="bg-muted h-4 w-48 animate-pulse rounded" />
          </li>
        ))}
      </ul>
    </div>
  )
}
