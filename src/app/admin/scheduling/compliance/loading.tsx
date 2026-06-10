import { AdminCardsSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulingComplianceLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Compliance rules</h1>
        <p className="text-muted-foreground text-sm">
          Define facility-level rules that drive scheduling warnings.
        </p>
      </div>
      <AdminCardsSkeleton count={4} cardClassName="h-40" gridClassName="grid gap-4 lg:grid-cols-2" />
    </div>
  )
}
