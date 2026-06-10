import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulingJobAreasLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Job areas</h1>
        <p className="text-muted-foreground text-sm">
          The areas employees can be assigned to (e.g. Front Desk, Concessions).
        </p>
      </div>
      <AdminTableSkeleton columns={5} rows={6} />
    </div>
  )
}
