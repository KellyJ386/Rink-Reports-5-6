import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulingPublishLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Publish history</h1>
        <p className="text-muted-foreground text-sm">
          Append-only log of scheduling publish events for this facility.
        </p>
      </div>
      <AdminTableSkeleton columns={4} rows={6} toolbar={false} />
    </div>
  )
}
