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
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export const metadata = { title: "Dashboard | MFO / Rink Reports" }

export default async function AdminDashboardPage() {
  const { profile } = await requireAdmin()
  const supabase = await createClient()

  const isSuperAdmin = profile?.is_super_admin ?? false
  const facilityId = profile?.facility_id

  // UTC midnight for "today" boundary
  const todayUtc = new Date()
  todayUtc.setUTCHours(0, 0, 0, 0)

  const [
    { count: facilityCount },
    { count: employeeCount },
    { count: dailyCount },
    { count: incidentCount },
    { count: accidentCount },
  ] = await Promise.all([
    isSuperAdmin
      ? supabase
          .from("facilities")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true)
      : Promise.resolve({ count: null }),
    facilityId
      ? supabase
          .from("employees")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", facilityId)
          .eq("is_active", true)
      : Promise.resolve({ count: null }),
    facilityId
      ? supabase
          .from("daily_report_submissions")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", facilityId)
          .gte("submitted_at", todayUtc.toISOString())
      : Promise.resolve({ count: null }),
    facilityId
      ? supabase
          .from("incident_reports")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", facilityId)
      : Promise.resolve({ count: null }),
    facilityId
      ? supabase
          .from("accident_reports")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", facilityId)
      : Promise.resolve({ count: null }),
  ])

  function fmt(n: number | null): string {
    if (n === null) return "—"
    return n.toLocaleString()
  }

  interface OverviewCard {
    title: string
    value: string
    description: string
    icon: typeof Building2
    superAdminOnly?: boolean
  }

  const cards: OverviewCard[] = [
    {
      title: "Total facilities",
      value: fmt(facilityCount),
      description: "Active facilities across the organization.",
      icon: Building2,
      superAdminOnly: true,
    },
    {
      title: "Active employees",
      value: fmt(employeeCount),
      description: "Currently active at this facility.",
      icon: Users,
    },
    {
      title: "Reports submitted today",
      value: fmt(dailyCount),
      description: "Daily report submissions for the current day.",
      icon: FileText,
    },
    {
      title: "Incidents & accidents",
      value: fmt(
        incidentCount !== null || accidentCount !== null
          ? (incidentCount ?? 0) + (accidentCount ?? 0)
          : null,
      ),
      description: "Total incident and accident reports on record.",
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
            and review activity.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
