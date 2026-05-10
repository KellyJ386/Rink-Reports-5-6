export default function DailyReportsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-40 animate-pulse rounded bg-muted" />
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 w-full animate-pulse rounded-xl border bg-muted/40"
          />
        ))}
      </div>
    </div>
  )
}
