import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
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
  // Select * — the form reads (and writes back) every policy flag, so an
  // omitted column here silently reverts that flag to its default on save.
  const { data: settings } = await supabase
    .from("schedule_settings")
    .select("*")
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
    <PageHeader
      title="Scheduling settings"
      description="Per-facility defaults and policies."
    />
  )
}
