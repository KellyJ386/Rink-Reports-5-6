export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-sm"
          >
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3 w-40 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-xl border bg-card shadow-sm" />
    </div>
  )
}
