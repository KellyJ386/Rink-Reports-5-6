import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function FacilityDocumentsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Facility Paperwork"
        description="Upload and manage the documents, policies, and manuals your staff can browse and download. Bulk-upload multiple files at once."
      />
      <AdminTableSkeleton columns={5} rows={6} />
    </div>
  )
}
