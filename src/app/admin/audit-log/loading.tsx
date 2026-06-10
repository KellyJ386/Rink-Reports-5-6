import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function AuditLogLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Audit Log"
        description="Immutable record of all create, update, delete, and authentication events across this facility."
      />
      <AdminTableSkeleton columns={6} rows={8} />
    </div>
  )
}
