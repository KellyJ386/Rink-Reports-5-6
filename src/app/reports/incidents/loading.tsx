export default function IncidentsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-40 animate-pulse rounded bg-muted" />
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-col gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ))}
        <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  )
}
