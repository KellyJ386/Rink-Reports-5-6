import {
  AlertTriangle,
  Building2,
  FileText,
  Users,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// TODO: replace with `import { requireAdmin } from "@/lib/auth"` (Agent A).
async function requireAdmin(): Promise<void> {
  return
}

export const dynamic = "force-dynamic"

interface OverviewCard {
  title: string
  value: string
  description: string
  icon: typeof Building2
  superAdminOnly?: boolean
}

export default async function AdminDashboardPage() {
  await requireAdmin()

  // TODO: wire counts to real data once the underlying tables exist.
  // (facilities, employees, daily_reports, incidents/accidents).
  const isSuperAdmin = false

  const cards: OverviewCard[] = [
    {
      title: "Total facilities",
      value: "—",
      description: "Across the organization (super admin view).",
      icon: Building2,
      superAdminOnly: true,
    },
    {
      title: "Active employees",
      value: "0",
      description: "Currently active at this facility.",
      icon: Users,
    },
    {
      title: "Reports submitted today",
      value: "0",
      description: "Daily report submissions for the current day.",
      icon: FileText,
    },
    {
      title: "Active incidents / accidents",
      value: "0",
      description: "Open incident and accident reports.",
      icon: AlertTriangle,
    },
  ]

  const visible = cards.filter((c) => !c.superAdminOnly || isSuperAdmin)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Overview of facility activity and operational status.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.title}
                  </CardTitle>
                  <Icon
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                </div>
                <div className="text-3xl font-semibold tracking-tight">
                  {card.value}
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{card.description}</CardDescription>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Welcome to the Admin Control Center</CardTitle>
          <CardDescription>
            Use the sidebar to manage facility setup, configure module access,
            and review activity. Sections marked &ldquo;Coming soon&rdquo; will
            be enabled in later phases.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
