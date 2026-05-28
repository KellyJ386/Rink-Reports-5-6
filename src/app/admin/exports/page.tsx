import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { EXPORTABLE_MODULES, moduleTitle } from "@/lib/exports/module-config"

import { ExportSettingsForm } from "./_components/export-settings-form"
import { RunExportPanel } from "./_components/run-export-panel"
import type { ExportSettingsRow } from "./types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Export Settings | MFO / Rink Reports" }

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

  const exportModules = EXPORTABLE_MODULES.map((key) => ({
    key,
    label: moduleTitle(key),
  }))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <RunExportPanel modules={exportModules} />
      <ExportSettingsForm settings={settings} />
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="PDF / Export Settings"
      description="Configure branding, layout, and default fields for exported PDFs and CSV reports."
    />
  )
}
