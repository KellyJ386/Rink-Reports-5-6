import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulePrintLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-muted-foreground text-sm">Preparing print view…</p>
      </div>
      <AdminTableSkeleton columns={8} rows={6} />
    </div>
  )
}
