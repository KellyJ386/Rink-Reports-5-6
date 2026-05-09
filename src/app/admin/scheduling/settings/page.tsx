import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"

import { SeedDefaultsButton } from "./_components/seed-defaults-button"
import { SettingsForm } from "./_components/settings-form"

export const dynamic = "force-dynamic"

export const metadata = { title: "Scheduling Settings | MFO / Rink Reports" }

export default async function SchedulingSettingsPage() {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before configuring scheduling settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: settings } = await supabase
    .from("schedule_settings")
    .select(
      "id, facility_id, week_start_day, default_shift_minutes, minor_max_weekly_hours, overtime_weekly_hours, minimum_break_minutes, minimum_break_after_hours, swap_requires_manager_approval, open_shift_first_come, notify_on_publish, notify_on_overtime"
    )
    .eq("facility_id", facilityId)
    .maybeSingle<Tables<"schedule_settings">>()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      {settings ? (
        <SettingsForm settings={settings} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No settings yet</CardTitle>
            <CardDescription>
              Seed sensible defaults to get started. You can change anything
              afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeedDefaultsButton />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Scheduling settings
      </h1>
      <p className="text-muted-foreground text-sm">
        Per-facility defaults and policies.
      </p>
    </div>
  )
}
