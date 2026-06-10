import { AdminTableSkeleton } from "@/components/admin/module-skeleton"

export default function SchedulingNotificationsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Read-only feed of scheduling notifications for this facility.
        </p>
      </div>
      <AdminTableSkeleton columns={3} rows={8} toolbar={false} />
    </div>
  )
}
