import Link from "next/link"
import { AlertTriangle } from "lucide-react"

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

import { PendingDestructionCard } from "./_components/pending-destruction-card"
import type { DestructionBatchView } from "./_components/pending-destruction-card"
import { RetentionRowForm } from "./_components/retention-row"
import type { RetentionRow } from "./types"
import { MODULES } from "./types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Data Retention | MFO / Rink Reports" }

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

  // Staged audit-destruction batches (migration 213): visible to facility
  // admins via RLS; approvals go through the two-person RPCs.
  const { data: batchRows } = await supabase
    .from("audit_destruction_batches")
    .select("id, staged_count, status, approved_by_1, approved_at_1, created_at")
    .eq("facility_id", facilityId)
    .eq("status", "staged")
    .order("created_at", { ascending: false })

  const approverIds = [
    ...new Set(
      (batchRows ?? [])
        .map((b) => b.approved_by_1)
        .filter((x): x is string => !!x)
    ),
  ]
  const approverLabels = new Map<string, string>()
  if (approverIds.length > 0) {
    const { data: approvers } = await supabase
      .from("users")
      .select("id, email")
      .in("id", approverIds)
    for (const u of approvers ?? []) {
      if (u.email) approverLabels.set(u.id, u.email)
    }
  }
  const batches: DestructionBatchView[] = (batchRows ?? []).map((b) => ({
    ...b,
    first_approver_label: b.approved_by_1
      ? (approverLabels.get(b.approved_by_1) ?? null)
      : null,
  }))

  const lastPurgeDate = (() => {
    const purgedRows = rows.filter((r) => r.last_purged_at)
    if (purgedRows.length === 0) return null
    const latest = purgedRows.reduce((a, b) =>
      (a.last_purged_at ?? "") > (b.last_purged_at ?? "") ? a : b
    )
    return latest.last_purged_at
  })()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Modules configured
            </CardTitle>
            <div className="text-3xl font-semibold">
              {rows.length} / {MODULES.length}
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Auto-purge enabled
            </CardTitle>
            <div className="text-3xl font-semibold">
              {rows.filter((r) => r.auto_purge).length}
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last purge ran
            </CardTitle>
            <div className="text-xl font-semibold">
              {lastPurgeDate
                ? new Date(lastPurgeDate).toLocaleDateString(undefined, { dateStyle: "medium" })
                : "Never"}
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Per-module rules */}
      <Card>
        <CardHeader>
          <CardTitle>Retention rules</CardTitle>
          <CardDescription>
            Set how long submitted data is kept for each module. Minimums apply
            for compliance. Auto-purge runs nightly and permanently deletes
            records older than the configured period. Use the Manual Purge
            button to run immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {MODULES.map((mod) => (
            <RetentionRowForm
              key={mod.key}
              moduleKey={mod.key}
              label={mod.label}
              description={mod.description}
              minDays={mod.minDays}
              existing={byModule.get(mod.key) ?? null}
            />
          ))}
        </CardContent>
      </Card>

      {/* Staged audit-destruction batches (two-person rule) */}
      <PendingDestructionCard batches={batches} />

      {/* Danger notice */}
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader className="flex-row items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base text-destructive">
              Auto-purge warning
            </CardTitle>
            <CardDescription>
              Enabling auto-purge permanently and irreversibly deletes records
              older than the configured threshold. Ensure you have reviewed your
              legal and regulatory retention obligations before enabling this
              feature — particularly for incident, accident, and workers&apos;
              compensation records. Deleted records cannot be recovered. Audit
              log records are the exception: they are first staged under
              &quot;pending destruction&quot; and only destroyed after two
              different admins approve.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Data Retention"
      description="Configure how long submitted data is stored for each module. All periods are measured from the record's submission date."
    />
  )
}
