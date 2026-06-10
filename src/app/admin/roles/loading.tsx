import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function RolesLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Roles"
        description="Manage facility roles and the permission defaults each role grants."
      />
      <AdminTableSkeleton columns={4} rows={5} />
    </div>
  )
}
