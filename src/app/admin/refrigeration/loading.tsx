export default function RefrigerationAdminLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-7 w-48 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-72 animate-pulse rounded-md" />
      </div>
      <div className="bg-muted h-10 w-72 animate-pulse rounded-md" />
      <div className="bg-card h-64 animate-pulse rounded-xl border shadow-sm" />
    </div>
  )
}
