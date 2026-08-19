import { PageHeader } from "@/components/ui/page-header"
import { AdminCardsSkeleton } from "@/components/admin/module-skeleton"

export default function ModulesLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Modules"
        description="Enable or disable modules for this facility. Disabled modules disappear from the staff navigation."
      />
      {/* One card per toggleable module. */}
      <AdminCardsSkeleton
        count={11}
        cardClassName="h-20"
        gridClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      />
    </div>
  )
}
