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

import { RetentionRowForm } from "./_components/retention-row"
import type { RetentionRow } from "./types"
import { MODULES } from "./types"

export const dynamic = "force-dynamic"

export default async function DataRetentionPage() {
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
              Create a facility before configuring data retention.
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
    .from("retention_settings")
    .select("*")
    .eq("facility_id", facilityId)

  const rows = (data ?? []) as RetentionRow[]
  const byModule = new Map(rows.map((r) => [r.module_key, r]))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      <Card>
        <CardHeader>
          <CardTitle>Retention rules</CardTitle>
          <CardDescription>
            Set how long submitted data is kept for each module. Minimums apply
            for compliance. Auto-purge runs nightly and permanently deletes
            records older than the configured period.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {MODULES.map((mod) => (
            <RetentionRowForm
              key={mod.key}
              moduleKey={mod.key}
              label={mod.label}
              description={mod.description}
              existing={byModule.get(mod.key) ?? null}
            />
          ))}
        </CardContent>
      </Card>

      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            Auto-purge notice
          </CardTitle>
          <CardDescription>
            Enabling auto-purge permanently and irreversibly deletes records
            older than the configured threshold. Ensure you have reviewed your
            legal and regulatory retention obligations before enabling this
            feature. Deleted records cannot be recovered.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Data Retention</h1>
      <p className="text-muted-foreground text-sm">
        Configure how long submitted data is stored for each module. All
        periods are measured from the record&apos;s submission date.
      </p>
    </div>
  )
}
