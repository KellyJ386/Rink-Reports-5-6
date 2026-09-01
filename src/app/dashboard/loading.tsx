import { PageHeader } from "@/components/ui/page-header"
import { AdminCardsSkeleton } from "@/components/admin/module-skeleton"

// /dashboard is force-dynamic and aggregates several widgets, each with its own
// multi-query load; without this the route rendered blank while they ran.
// Mirrors the page's shell and the module-tile grid.
export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow="Operations" title="Welcome" />
      <div className="mt-6">
        <AdminCardsSkeleton
          count={8}
          cardClassName="h-[200px]"
          gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        />
      </div>
    </div>
  )
}
