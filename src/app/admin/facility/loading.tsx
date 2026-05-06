export default function FacilityLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="bg-muted h-7 w-48 animate-pulse rounded-md" />
          <div className="bg-muted h-4 w-72 animate-pulse rounded-md" />
        </div>
        <div className="bg-muted h-9 w-32 animate-pulse rounded-md" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-card flex flex-col gap-3 rounded-xl border p-6 shadow-sm"
          >
            <div className="bg-muted h-5 w-48 animate-pulse rounded" />
            <div className="bg-muted h-3 w-64 animate-pulse rounded" />
            <div className="bg-muted h-3 w-32 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
