import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function DepartmentsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Departments"
        description="Define the departments for this facility. They power the Employee Schedule department filter, shift assignment, and communication routing."
      />
      <AdminTableSkeleton columns={4} rows={5} />
    </div>
  )
}
