import {
  AdminCardsSkeleton,
  SkeletonBlock,
} from "@/components/admin/module-skeleton"

export default function SchedulingHubLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Scheduling overview
        </h1>
        <SkeletonBlock className="h-4 w-64" />
      </div>
      <AdminCardsSkeleton count={4} cardClassName="h-28" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
