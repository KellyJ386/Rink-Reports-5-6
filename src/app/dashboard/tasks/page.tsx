import { Badge } from "@/components/ui/badge"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { getMyCleaningTasks } from "@/lib/tasks/cleaning"

export const dynamic = "force-dynamic"
export const metadata = { title: "My Tasks | Rink Reports" }

export default async function MyTasksPage() {
  await requireUser()
  const tasks = await getMyCleaningTasks()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        breadcrumb={<Breadcrumb segments={[{ label: "Dashboard", href: "/dashboard" }, { label: "My tasks" }]} />}
        title="My tasks"
        description="Work assigned directly to you."
      />
      {tasks.length === 0 ? (
        <Card><CardHeader><CardDescription>You have no assigned tasks.</CardDescription></CardHeader></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <Card key={task.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{task.facility_locker_rooms?.name ?? "Locker room"}</CardTitle>
                  <Badge variant={task.status === "completed" ? "success" : "secondary"}>{task.status}</Badge>
                </div>
                <CardDescription>
                  Cleaning · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.scheduled_for))}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
