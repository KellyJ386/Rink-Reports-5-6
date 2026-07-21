export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-7 w-56 rounded" />
        <div className="bg-muted h-4 w-96 max-w-full rounded" />
      </div>
      <div className="bg-muted h-10 w-72 rounded-md" />
      <div className="bg-muted h-96 rounded-xl" />
    </div>
  )
}
