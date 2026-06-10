import { PageHeader } from "@/components/ui/page-header"
import { AdminCardsSkeleton } from "@/components/admin/module-skeleton"

export default function RetentionLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Data Retention"
        description="Configure how long submitted data is stored for each module. All periods are measured from the record's submission date."
      />
      <AdminCardsSkeleton
        count={6}
        cardClassName="h-32"
        gridClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      />
    </div>
  )
}
