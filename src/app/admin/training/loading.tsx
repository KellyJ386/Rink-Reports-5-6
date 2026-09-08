import { PageHeader } from "@/components/ui/page-header"
import { SkeletonBlock } from "@/components/admin/module-skeleton"

export default function TrainingLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Training & Documentation"
        description="Every Rink Reports training guide, manual, and module chapter in one place. Read them here or download the PDF to print or hand out."
      />
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-6 w-64" />
        <SkeletonBlock className="h-40 w-full" />
        <SkeletonBlock className="h-6 w-48" />
        <SkeletonBlock className="h-64 w-full" />
      </div>
    </div>
  )
}
