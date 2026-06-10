import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulingTimeOffLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Time-off requests</h1>
        <p className="text-muted-foreground text-sm">
          Approve, deny, or cancel employee time-off requests.
        </p>
      </div>
      <AdminTableSkeleton columns={5} rows={6} />
    </div>
  )
}
