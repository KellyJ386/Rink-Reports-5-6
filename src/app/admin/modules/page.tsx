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
import { TOGGLEABLE_MODULE_KEYS } from "@/lib/modules/module-keys"
import { createClient } from "@/lib/supabase/server"

import { ModuleToggles } from "./_components/module-toggles"

export const dynamic = "force-dynamic"

export const metadata = { title: "Modules | MFO / Rink Reports" }

export default async function FacilityModulesAdminPage() {
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
              Create a facility before managing its modules.
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
    .from("facility_modules")
    .select("module_key, enabled")
    .eq("facility_id", facilityId)

  // Default missing rows to enabled (fail-open, matches the nav helper).
  const enabled: Record<string, boolean> = {}
  for (const key of TOGGLEABLE_MODULE_KEYS) enabled[key] = true
  for (const row of data ?? []) {
    if (row.module_key in enabled) enabled[row.module_key] = row.enabled
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <Card>
        <CardHeader>
          <CardTitle>Staff modules</CardTitle>
          <CardDescription>
            Turn a module off to hide it from the staff navigation for this
            facility. This is a visibility switch only — it does not change
            per-employee permissions, and disabled modules remain protected by
            their own access rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModuleToggles enabled={enabled} />
        </CardContent>
      </Card>
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Modules"
      description="Enable or disable modules for this facility. Disabled modules disappear from the staff navigation."
    />
  )
}
