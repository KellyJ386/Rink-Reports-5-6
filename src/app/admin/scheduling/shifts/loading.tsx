import { SkeletonBlock } from "@/components/admin/module-skeleton"

export default function SchedulingShiftsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
        <p className="text-muted-foreground text-sm">
          Drag on a day column to paint a shift. Move or resize existing shifts
          to reschedule — changes save automatically.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-9 w-64" />
        <SkeletonBlock className="h-9 w-40" />
      </div>
      <SkeletonBlock className="h-[60vh] rounded-xl" />
    </div>
  )
}
