import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

type StaffModule = {
  key:
    | "daily_reports"
    | "incident_reports"
    | "accident_reports"
    | "refrigeration"
    | "air_quality"
  title: string
  description: string
  href: string
}

const KNOWN_MODULES: Record<StaffModule["key"], Omit<StaffModule, "key">> = {
  daily_reports: {
    title: "Daily Reports",
    description: "Submit your daily checklist for an assigned area.",
    href: "/reports/daily",
  },
  incident_reports: {
    title: "Incident Reports",
    description: "Report an incident or unusual occurrence.",
    href: "/reports/incidents",
  },
  accident_reports: {
    title: "Accident Reports",
    description: "Report an accident or injury.",
    href: "/reports/accidents",
  },
  refrigeration: {
    title: "Refrigeration",
    description: "Submit refrigeration readings for the facility.",
    href: "/reports/refrigeration",
  },
  air_quality: {
    title: "Air Quality",
    description: "Submit air quality readings for a location.",
    href: "/reports/air-quality",
  },
}

export default async function ReportsHomePage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, first_name, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <Card>
          <CardHeader>
            <CardTitle>Account not ready</CardTitle>
            <CardDescription>
              Your account is being set up. Contact your administrator to
              finish setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignOutButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  const { data: modulePerms } = await supabase
    .from("module_permissions")
    .select("module_key, can_view, can_submit")
    .eq("employee_id", employeeRow.id)

  const submittableKeys = new Set(
    (modulePerms ?? [])
      .filter((row) => row.can_submit || row.can_view)
      .map((row) => row.module_key)
  )

  const modules: StaffModule[] = (
    Object.keys(KNOWN_MODULES) as StaffModule["key"][]
  )
    .filter((key) => submittableKeys.has(key))
    .map((key) => ({ key, ...KNOWN_MODULES[key] }))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hi{employeeRow.first_name ? `, ${employeeRow.first_name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a module to get started.
        </p>
      </div>

      {modules.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No modules assigned yet</CardTitle>
            <CardDescription>
              You don&apos;t have access to any staff modules yet. Talk to your
              supervisor.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((m) => (
            <Link
              key={m.key}
              href={m.href}
              className="group rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-colors group-hover:bg-accent/30">
                <CardHeader>
                  <CardTitle className="text-lg">{m.title}</CardTitle>
                  <CardDescription>{m.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
