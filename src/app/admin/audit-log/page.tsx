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

import { AuditLogFilters } from "./_components/audit-log-filters"
import { AuditLogTable } from "./_components/audit-log-table"
import { LogDetail } from "./_components/log-detail"
import type { AuditLogEntry, AuditLogRow, EmployeeLite } from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  action?: string
  entity_type?: string
  actor?: string
  from?: string
  to?: string
  q?: string
  entry?: string
}>

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function buildDetailHref(
  id: string,
  params: Record<string, string | undefined>,
): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v)
  }
  sp.set("entry", id)
  return `/admin/audit-log?${sp.toString()}`
}

function buildBackHref(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k !== "entry" && v) sp.set(k, v)
  }
  return `/admin/audit-log?${sp.toString()}`
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const params = await searchParams
  const facilityId = current.profile?.facility_id ?? null
  const isSuperAdmin = current.profile?.is_super_admin ?? false

  if (!facilityId && !isSuperAdmin) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before viewing the audit log.
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

  // Load employees for filter dropdown (scoped to facility)
  const empsRes = facilityId
    ? await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("last_name", { ascending: true })
    : { data: [] }
  const employees = (empsRes.data ?? []) as EmployeeLite[]

  // Build query
  const from = params.from ?? defaultFrom()
  const to = params.to ?? null

  let q = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300)

  if (facilityId) q = q.eq("facility_id", facilityId)
  if (params.action) q = q.eq("action", params.action)
  if (params.entity_type) q = q.eq("entity_type", params.entity_type)
  if (params.actor) q = q.eq("actor_employee_id", params.actor)
  if (from) q = q.gte("created_at", `${from}T00:00:00.000Z`)
  if (to) q = q.lte("created_at", `${to}T23:59:59.999Z`)
  if (params.q) {
    const search = params.q.trim()
    // Search by IP (cast) or entity_id text match
    q = q.or(`entity_id::text.ilike.%${search}%`)
  }

  const { data: rawEntries } = await q
  const rows = (rawEntries ?? []) as AuditLogRow[]

  // Resolve actor employees
  const actorEmpIds = Array.from(
    new Set(
      rows
        .map((r) => r.actor_employee_id)
        .filter((x): x is string => !!x),
    ),
  )
  let actorEmps: EmployeeLite[] = []
  if (actorEmpIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", actorEmpIds)
    actorEmps = (data ?? []) as EmployeeLite[]
  }
  const empById = new Map(actorEmps.map((e) => [e.id, e]))

  const entries: AuditLogEntry[] = rows.map((r) => ({
    ...r,
    actor_employee: r.actor_employee_id
      ? (empById.get(r.actor_employee_id) ?? null)
      : null,
  }))

  const filterParams = {
    action: params.action,
    entity_type: params.entity_type,
    actor: params.actor,
    from,
    to: params.to,
    q: params.q,
  }

  // Detail view
  const activeEntryId = params.entry ?? null
  let detail: AuditLogEntry | null = null
  if (activeEntryId) {
    detail =
      entries.find((e) => e.id === activeEntryId) ??
      (await loadSingleEntry(supabase, activeEntryId, facilityId, empById))
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      {detail ? (
        <LogDetail
          entry={detail}
          backHref={buildBackHref({ ...filterParams, entry: undefined })}
        />
      ) : (
        <>
          <AuditLogFilters employees={employees} params={filterParams} />
          <p className="text-xs text-muted-foreground">
            Showing up to 300 entries. Use filters to narrow results.
          </p>
          <AuditLogTable
            entries={entries}
            activeEntryId={activeEntryId}
            buildDetailHref={(id) =>
              buildDetailHref(id, filterParams as Record<string, string | undefined>)
            }
          />
        </>
      )}
    </div>
  )
}

async function loadSingleEntry(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  entryId: string,
  facilityId: string | null,
  empById: Map<string, EmployeeLite>,
): Promise<AuditLogEntry | null> {
  let q = supabase
    .from("audit_logs")
    .select("*")
    .eq("id", entryId)
  if (facilityId) q = q.eq("facility_id", facilityId)
  const { data } = await q.maybeSingle()
  if (!data) return null
  const row = data as AuditLogRow
  let actor: EmployeeLite | null =
    row.actor_employee_id ? (empById.get(row.actor_employee_id) ?? null) : null
  if (!actor && row.actor_employee_id) {
    const { data: e } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("id", row.actor_employee_id)
      .maybeSingle()
    actor = (e as EmployeeLite | null) ?? null
  }
  return { ...row, actor_employee: actor }
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
      <p className="text-muted-foreground text-sm">
        Immutable record of all create, update, delete, and authentication
        events across this facility.
      </p>
    </div>
  )
}
