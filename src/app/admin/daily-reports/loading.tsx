import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function DailyReportsAdminLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Daily Reports"
        description="Configure areas, templates, and checklists. Review and edit recent submissions. Reports auto-delete after 14 days."
      />
      <AdminTableSkeleton columns={5} rows={6} />
    </div>
  )
}
