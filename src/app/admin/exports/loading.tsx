import { PageHeader } from "@/components/ui/page-header"
import { AdminCardsSkeleton } from "@/components/admin/module-skeleton"

export default function ExportsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="PDF / Export Settings"
        description="Configure branding, layout, and default fields for exported PDFs and CSV reports."
      />
      <AdminCardsSkeleton
        count={4}
        cardClassName="h-56"
        gridClassName="grid gap-4 lg:grid-cols-2"
      />
    </div>
  )
}
