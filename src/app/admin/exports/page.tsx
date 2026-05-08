import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { ExportSettingsForm } from "./_components/export-settings-form"
import type { ExportSettingsRow } from "./types"

export const dynamic = "force-dynamic"

export default async function ExportSettingsPage() {
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
              Create a facility before configuring export settings.
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
  const { data } = await supabase
    .from("export_settings")
    .select("*")
    .eq("facility_id", facilityId)
    .maybeSingle()

  const settings = (data ?? null) as ExportSettingsRow | null

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <ExportSettingsForm settings={settings} />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">PDF / Export Settings</h1>
      <p className="text-muted-foreground text-sm">
        Configure branding, layout, and default fields for exported PDFs and
        CSV reports.
      </p>
    </div>
  )
}
