import { PageHeader } from "@/components/ui/page-header"
import { AdminCardsSkeleton } from "@/components/admin/module-skeleton"

export default function SuperAdminLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Super Admin"
        description="Cross-facility platform management. Changes here affect all tenants."
      />
      <AdminCardsSkeleton
        count={4}
        cardClassName="h-48"
        gridClassName="grid gap-4 lg:grid-cols-2"
      />
    </div>
  )
}
