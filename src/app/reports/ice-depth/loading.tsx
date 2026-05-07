export default function IceDepthLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-40 animate-pulse rounded bg-muted" />
        <div className="h-7 w-64 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="aspect-[0.425] w-full animate-pulse rounded-xl bg-muted" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border bg-card p-3"
          >
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <div className="h-10 flex-1 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
        <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  )
}
