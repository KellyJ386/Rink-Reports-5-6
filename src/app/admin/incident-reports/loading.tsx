import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function IncidentReportsAdminLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Incident Reports"
        description="Review submitted incident reports, track follow-ups, and configure types and severity levels. Original reports are immutable."
      />
      <AdminTableSkeleton columns={6} rows={6} />
    </div>
  )
}
