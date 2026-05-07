export default function Loading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <div className="bg-muted h-7 w-40 animate-pulse rounded" />
        <div className="bg-muted h-4 w-80 animate-pulse rounded" />
      </div>
      <div className="bg-muted h-10 w-full animate-pulse rounded" />
      <div className="bg-muted h-72 w-full animate-pulse rounded" />
    </div>
  )
}
