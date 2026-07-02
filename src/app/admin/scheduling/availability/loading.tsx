import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulingAvailabilityLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Staff availability
        </h1>
        <p className="text-muted-foreground text-sm">
          Weekly availability submitted by staff, laid onto the facility-local
          calendar week.
        </p>
      </div>
      <AdminTableSkeleton columns={8} rows={6} />
    </div>
  )
}
