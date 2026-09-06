import Link from "next/link"
import { redirect } from "next/navigation"

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

type FacilityOption = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

type SearchParams = Promise<{ facility?: string }>

export default async function ExportSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const profile = current.profile
  const params = await searchParams

  // Same convention as /admin/employees: a super admin scopes via ?facility=
  // (their profile facility_id may be NULL by design); everyone else is pinned
  // to their own facility. The server actions re-validate the override, so the
  // searchParam is a navigation convenience, not the authority.
  const facilityId = profile?.is_super_admin
    ? (params?.facility ?? null)
    : (profile?.facility_id ?? null)

  if (!facilityId && profile?.is_super_admin) {
    const supabase = await createClient()
    const { data: facilitiesRaw } = await supabase
      .from("facilities")
      .select("id, name, slug, is_active")
      .order("created_at", { ascending: true })

    const facilities = (facilitiesRaw ?? []) as FacilityOption[]

    if (facilities.length === 1) {
      redirect(`/admin/exports?facility=${facilities[0].id}`)
    }

    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>
              {facilities.length === 0
                ? "No facilities yet"
                : "Choose a facility"}
            </CardTitle>
            <CardDescription>
              {facilities.length === 0
                ? "Create a facility before configuring export settings."
                : "Pick a facility to configure its export settings and run exports."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {facilities.length === 0 ? (
              <Button asChild>
                <Link href="/admin/facility">Go to Facility Settings</Link>
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                {facilities.map((f) => (
                  <Button
                    key={f.id}
                    asChild
                    variant="outline"
                    className="justify-between"
                  >
                    <Link href={`/admin/exports?facility=${f.id}`}>
                      <span>
                        {f.name}
                        {!f.is_active && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            (Inactive)
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {f.slug}
                      </span>
                    </Link>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

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

  // Thread the override only when it IS one (super admin via ?facility=);
  // facility-scoped admins keep the implicit own-facility path.
  const facilityOverride = profile?.is_super_admin ? facilityId : null

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <RunExportPanel modules={exportModules} facilityId={facilityOverride} />
      <ExportSettingsForm settings={settings} facilityId={facilityOverride} />
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
