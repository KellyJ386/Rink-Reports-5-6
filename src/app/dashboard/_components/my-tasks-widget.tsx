import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getMyCleaningTasks } from "@/lib/tasks/cleaning"

export async function MyTasksWidget() {
  const tasks = (await getMyCleaningTasks()).filter(
    (task) => task.status === "scheduled",
  )
  if (tasks.length === 0) return null

  const next = tasks[0]
  return (
    <Link href="/dashboard/tasks" className="mb-6 block no-underline">
      <Card className="border-l-4 border-l-primary transition-colors hover:bg-accent/40">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>My tasks</CardTitle>
            <Badge>{tasks.length}</Badge>
          </div>
          <CardDescription>
            Locker-room cleaning: {next.facility_locker_rooms?.name ?? "assigned room"}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  )
}
