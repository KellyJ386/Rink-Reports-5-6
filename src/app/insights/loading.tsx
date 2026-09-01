import { PageHeader } from "@/components/ui/page-header"
import { AdminCardsSkeleton } from "@/components/admin/module-skeleton"

// /insights is force-dynamic and does an RPC plus several sequential/parallel
// queries; without this the route rendered blank while they ran. Mirrors the
// page's shell and header so the swap to real content is seamless.
export default function InsightsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        eyebrow="Reporting"
        title="Insights"
        description="Facility-wide compliance and activity reporting, aggregated across every module."
      />
      <AdminCardsSkeleton
        count={6}
        cardClassName="h-40"
        gridClassName="grid gap-4 sm:grid-cols-2"
      />
    </div>
  )
}
