import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulingTemplatesLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="text-muted-foreground text-sm">
          Define recurring schedule templates and apply them to a week.
        </p>
      </div>
      <AdminTableSkeleton columns={5} rows={6} />
    </div>
  )
}
