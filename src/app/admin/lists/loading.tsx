import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function ListsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Lists"
        description="Customize the per-facility option lists used by dropdowns across the app. Changes apply only to your facility."
      />
      <AdminTableSkeleton columns={4} rows={8} />
    </div>
  )
}
