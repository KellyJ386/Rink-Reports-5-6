import { PageHeader } from "@/components/ui/page-header"
import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SpacesLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Facility Spaces"
        description="The shared list of physical areas for this facility. These feed the space/location pickers in Incident Reports, Accident Reports, and Air Quality."
      />
      <AdminTableSkeleton columns={3} rows={8} />
    </div>
  )
}
