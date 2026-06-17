import Link from "next/link"
import {
  AlertCircle,
  AlertTriangle,
  Ambulance,
  Building2,
  Check,
  CheckCircle2,
  CircleGauge,
  Circle,
  Clock,
  FileText,
  MessageSquare,
  Ruler,
  Snowflake,
  Truck,
  Users,
  Wind,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
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

import { FacilitySwitcher } from "./_components/facility-switcher"

export const dynamic = "force-dynamic"

export const metadata = { title: "Dashboard | MFO / Rink Reports" }

type SearchParams = Promise<{ facility?: string }>

type FacilityOption = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

type ChecklistItem = {
  key: string
  label: string
  done: boolean
  description: string
  href: string
  cta: string
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { profile } = await requireAdmin()
  const supabase = await createClient()

  const isSuperAdmin = profile?.is_super_admin ?? false

  const params = await searchParams
  const requestedFacility = params.facility?.trim()

  let activeFacilityId: string | null = null
  let facilityOptions: FacilityOption[] = []

  if (isSuperAdmin) {
    const { data: facs } = await supabase
      .from("facilities")
      .select("id, name, slug, is_active")
      .order("name", { ascending: true })
    facilityOptions = (facs ?? []) as FacilityOption[]
    if (requestedFacility) {
      activeFacilityId =
        facilityOptions.find((f) => f.id === requestedFacility)?.id ?? null
    }
    if (!activeFacilityId) {
      activeFacilityId =
        facilityOptions.find((f) => f.is_active)?.id ??
        facilityOptions[0]?.id ??
        null
    }
  } else {
    activeFacilityId = profile?.facility_id ?? null
  }

  const checklist: ChecklistItem[] = []
  let facility: {
    id: string
    name: string
    slug: string
    address: string | null
    phone: string | null
  } | null = null

  let roleCount = 0
  let roleDefaultsCount = 0
  let activeAdminLinkedCount = 0
  let activeStaffCount = 0
  let inviteCoverage: { needed: number; covered: number } = {
    needed: 0,
    covered: 0,
  }

  if (activeFacilityId) {
    const facilityIdStr = activeFacilityId

    const { data: fac } = await supabase
      .from("facilities")
      .select("id, name, slug, address, phone")
      .eq("id", facilityIdStr)
      .maybeSingle()
    facility = fac ?? null

    const [
      { count: roleC },
      { count: roleDefC },
      { data: adminEmps },
      { data: staffEmps },
      { data: emailEmps },
    ] = await Promise.all([
      supabase
        .from("roles")
        .select("*", { count: "exact", head: true })
        .eq("facility_id", facilityIdStr),
      supabase
        .from("role_permission_defaults")
        .select("*", { count: "exact", head: true })
        .eq("facility_id", facilityIdStr)
        .eq("enabled", true),
      supabase
        .from("employees")
        .select("id, user_id, role_id, roles!inner(key)")
        .eq("facility_id", facilityIdStr)
        .eq("is_active", true)
        .in("roles.key", ["admin", "super_admin"]),
      supabase
        .from("employees")
        .select("id, roles!inner(key)")
        .eq("facility_id", facilityIdStr)
        .eq("is_active", true)
        .not("roles.key", "in", "(super_admin,admin)"),
      supabase
        .from("employees")
        .select("id, user_id, email")
        .eq("facility_id", facilityIdStr)
        .eq("is_active", true)
        .not("email", "is", null),
    ])

    roleCount = roleC ?? 0
    roleDefaultsCount = roleDefC ?? 0
    activeAdminLinkedCount = (adminEmps ?? []).filter(
      (e: { user_id: string | null }) => e.user_id !== null
    ).length
    activeStaffCount = (staffEmps ?? []).length

    const needsInvite = (emailEmps ?? []) as Array<{
      id: string
      user_id: string | null
    }>
    inviteCoverage = {
      needed: needsInvite.length,
      covered: needsInvite.filter((e) => e.user_id !== null).length,
    }

    checklist.push(
      {
        key: "facility",
        label: "Facility info",
        done: !!facility && !!facility.name && !!facility.slug,
        description: facility
          ? `${facility.name} (${facility.slug})`
          : "Set the facility name, slug, and contact details.",
        href: "/admin/facility",
        cta: "Open facility settings",
      },
      {
        key: "roles",
        label: "Canonical roles seeded",
        done: roleCount >= 4,
        description:
          roleCount >= 4
            ? `${roleCount} roles configured.`
            : "Seed the 4 canonical roles (Super Admin, Administrator, Manager, Staff).",
        href: "/admin/roles",
        cta: "Open roles",
      },
      {
        key: "role-defaults",
        label: "Role permission defaults",
        done: roleDefaultsCount > 0,
        description:
          roleDefaultsCount > 0
            ? `${roleDefaultsCount} role-default entries set.`
            : "Set at least one module → permission default per role so staff can submit.",
        href: "/admin/roles",
        cta: "Set role defaults",
      },
      {
        key: "first-admin",
        label: "First admin linked",
        done: activeAdminLinkedCount > 0,
        description:
          activeAdminLinkedCount > 0
            ? `${activeAdminLinkedCount} admin user(s) linked.`
            : "Invite at least one admin so this facility has a non-super-admin owner.",
        href: "/admin/employees",
        cta: "Manage admins",
      },
      {
        key: "staff",
        label: "Staff added",
        done: activeStaffCount > 0,
        description:
          activeStaffCount > 0
            ? `${activeStaffCount} active staff member(s).`
            : "Add the first staff member to start collecting reports.",
        href: "/admin/employees",
        cta: "Add staff",
      },
      {
        key: "invites",
        label: "Invites sent",
        done:
          inviteCoverage.needed === 0 ||
          inviteCoverage.covered === inviteCoverage.needed,
        description:
          inviteCoverage.needed === 0
            ? "No employees with email addresses yet."
            : `${inviteCoverage.covered}/${inviteCoverage.needed} employees linked to a login.`,
        href: "/admin/employees",
        cta: "Send invites",
      }
    )
  }

  const completedCount = checklist.filter((c) => c.done).length

  // Rolling window boundaries. `last 7 days` / `last 30 days` are inclusive
  // windows measured back from "now" in UTC (Postgres stores these timestamps
  // as timestamptz, so a UTC ISO boundary compares correctly regardless of the
  // viewer's locale). A single `new Date()` read keeps both boundaries derived
  // from the same instant; we subtract whole days so the window edge is stable.
  const nowUtc = new Date()
  const since = (days: number): string => {
    const d = new Date(nowUtc)
    d.setUTCDate(d.getUTCDate() - days)
    return d.toISOString()
  }
  const last7Iso = since(7)
  const last30Iso = since(30)

  // Each report module's submission/record table + the timestamp column that
  // represents when the record was captured. Most use `submitted_at`; shifts and
  // communications have no submit step, so we fall back to `created_at`.
  type ModuleSource = {
    key: string
    title: string
    table:
      | "daily_report_submissions"
      | "ice_depth_sessions"
      | "ice_operations_submissions"
      | "refrigeration_reports"
      | "air_quality_reports"
      | "incident_reports"
      | "accident_reports"
      | "schedule_shifts"
      | "communication_messages"
    tsColumn: "submitted_at" | "created_at"
    icon: typeof Building2
  }

  const moduleSources: ModuleSource[] = [
    {
      key: "daily",
      title: "Daily reports",
      table: "daily_report_submissions",
      tsColumn: "submitted_at",
      icon: FileText,
    },
    {
      key: "ice_depth",
      title: "Ice depth",
      table: "ice_depth_sessions",
      tsColumn: "submitted_at",
      icon: Ruler,
    },
    {
      key: "ice_operations",
      title: "Ice operations",
      table: "ice_operations_submissions",
      tsColumn: "submitted_at",
      icon: Truck,
    },
    {
      key: "refrigeration",
      title: "Refrigeration",
      table: "refrigeration_reports",
      tsColumn: "submitted_at",
      icon: Snowflake,
    },
    {
      key: "air_quality",
      title: "Air quality",
      table: "air_quality_reports",
      tsColumn: "submitted_at",
      icon: Wind,
    },
    {
      key: "incidents",
      title: "Incident reports",
      table: "incident_reports",
      tsColumn: "submitted_at",
      icon: AlertTriangle,
    },
    {
      key: "accidents",
      title: "Accident reports",
      table: "accident_reports",
      tsColumn: "submitted_at",
      icon: Ambulance,
    },
    {
      key: "scheduling",
      title: "Scheduling",
      table: "schedule_shifts",
      tsColumn: "created_at",
      icon: CircleGauge,
    },
    {
      key: "communications",
      title: "Communications",
      table: "communication_messages",
      tsColumn: "created_at",
      icon: MessageSquare,
    },
  ]

  type WindowCount = { last7: number | null; last30: number | null }

  // Count queries only (head:true, count:"exact") — no rows fetched. Two
  // bounded counts per module, all fired in parallel.
  const moduleCountResults = await Promise.all(
    moduleSources.map(async (m): Promise<WindowCount> => {
      if (!activeFacilityId) return { last7: null, last30: null }
      const [{ count: c7 }, { count: c30 }] = await Promise.all([
        supabase
          .from(m.table)
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .gte(m.tsColumn, last7Iso),
        supabase
          .from(m.table)
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .gte(m.tsColumn, last30Iso),
      ])
      return { last7: c7 ?? null, last30: c30 ?? null }
    })
  )

  const moduleActivity = moduleSources.map((m, i) => ({
    ...m,
    ...moduleCountResults[i],
  }))

  const [{ count: facilityCount }, { count: employeeCount }] =
    await Promise.all([
      isSuperAdmin
        ? supabase
            .from("facilities")
            .select("*", { count: "exact", head: true })
            .eq("is_active", true)
        : Promise.resolve({ count: null }),
      activeFacilityId
        ? supabase
            .from("employees")
            .select("*", { count: "exact", head: true })
            .eq("facility_id", activeFacilityId)
            .eq("is_active", true)
        : Promise.resolve({ count: null }),
    ])

  // Offline sync queue health. The table is facility-scoped and RLS already
  // limits an admin to their own facility's rows; we additionally pin the
  // facility filter so the super-admin facility switcher is honored (RLS uses
  // the viewer's own facility, which a super admin doesn't have). Pure count
  // queries by sync_status, plus the most recent activity timestamp.
  const [
    { count: syncPending },
    { count: syncSynced },
    { count: syncFailed },
    { data: syncLatest },
  ] = await Promise.all([
    activeFacilityId
      ? supabase
          .from("offline_sync_queue")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .eq("sync_status", "pending")
      : Promise.resolve({ count: null }),
    activeFacilityId
      ? supabase
          .from("offline_sync_queue")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .eq("sync_status", "synced")
      : Promise.resolve({ count: null }),
    activeFacilityId
      ? supabase
          .from("offline_sync_queue")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .eq("sync_status", "failed")
      : Promise.resolve({ count: null }),
    activeFacilityId
      ? supabase
          .from("offline_sync_queue")
          .select("started_at, synced_at, sync_status")
          .eq("facility_id", activeFacilityId)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const syncQueue = {
    pending: syncPending ?? null,
    synced: syncSynced ?? null,
    failed: syncFailed ?? null,
    latestAt:
      (syncLatest as { synced_at: string | null; started_at: string } | null)
        ?.synced_at ??
      (syncLatest as { started_at: string } | null)?.started_at ??
      null,
    available:
      syncPending !== null || syncSynced !== null || syncFailed !== null,
  }

  function fmt(n: number | null): string {
    if (n === null) return "—"
    return n.toLocaleString()
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return "No activity yet"
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })
  }

  interface OverviewCard {
    title: string
    value: string
    description: string
    icon: typeof Building2
    superAdminOnly?: boolean
  }

  const cards: OverviewCard[] = [
    {
      title: "Total facilities",
      value: fmt(facilityCount),
      description: "Active facilities across the organization.",
      icon: Building2,
      superAdminOnly: true,
    },
    {
      title: "Active employees",
      value: fmt(employeeCount),
      description: "Currently active at this facility.",
      icon: Users,
    },
  ]
  const visible = cards.filter((c) => !c.superAdminOnly || isSuperAdmin)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Admin Dashboard"
        description="Setup status and operational overview for the selected facility."
        actions={
          isSuperAdmin && facilityOptions.length > 0 ? (
            <FacilitySwitcher
              facilities={facilityOptions}
              activeFacilityId={activeFacilityId}
            />
          ) : null
        }
      />

      {activeFacilityId ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Setup checklist</CardTitle>
                <CardDescription>
                  {facility?.name ?? "Selected facility"} · {completedCount}/
                  {checklist.length} complete
                </CardDescription>
              </div>
              <Badge variant={completedCount === checklist.length ? "success" : "secondary"}>
                {completedCount === checklist.length
                  ? "Ready"
                  : `${checklist.length - completedCount} left`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {checklist.map((item) => (
              <div
                key={item.key}
                className="border-border flex flex-wrap items-center justify-between gap-3 rounded border p-3"
              >
                <div className="flex items-start gap-3">
                  {item.done ? (
                    <Check
                      className="mt-0.5 size-4 text-emerald-500"
                      aria-hidden
                    />
                  ) : (
                    <Circle
                      className="text-muted-foreground mt-0.5 size-4"
                      aria-hidden
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {item.description}
                    </span>
                  </div>
                </div>
                <Button asChild size="sm" variant={item.done ? "outline" : "default"}>
                  <Link
                    href={
                      isSuperAdmin
                        ? `${item.href}?facility=${activeFacilityId}`
                        : item.href
                    }
                  >
                    {item.cta}
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No facility selected</CardTitle>
            <CardDescription>
              {isSuperAdmin
                ? "Create a facility in Facility Settings to get started."
                : "Your account isn't linked to a facility yet. Contact your administrator."}
            </CardDescription>
          </CardHeader>
          {isSuperAdmin && (
            <CardContent>
              <Button asChild>
                <Link href="/admin/facility">Open facility settings</Link>
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-muted-foreground text-sm font-medium">
                    {card.title}
                  </CardTitle>
                  <Icon
                    className="text-muted-foreground h-4 w-4"
                    aria-hidden
                  />
                </div>
                <div className="text-3xl font-semibold tracking-tight">
                  {card.value}
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{card.description}</CardDescription>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {activeFacilityId && (
        <Card>
          <CardHeader>
            <CardTitle>Recent report activity</CardTitle>
            <CardDescription>
              Submissions per module — last 7 and last 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {moduleActivity.map((m) => {
                const Icon = m.icon
                return (
                  <div
                    key={m.key}
                    className="border-border bg-background flex flex-col gap-2 rounded-lg border p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{m.title}</span>
                      <Icon
                        className="text-muted-foreground size-4"
                        aria-hidden
                      />
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="text-2xl font-semibold tracking-tight">
                          {fmt(m.last7)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          last 7 days
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-lg font-semibold tracking-tight">
                          {fmt(m.last30)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          last 30 days
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {activeFacilityId && (
        <Card>
          <CardHeader>
            <CardTitle>Offline sync queue</CardTitle>
            <CardDescription>
              Health of submissions captured offline at this facility.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <Clock className="mr-1 size-3" aria-hidden />
                {fmt(syncQueue.pending)} pending
              </Badge>
              <Badge variant="success">
                <CheckCircle2 className="mr-1 size-3" aria-hidden />
                {fmt(syncQueue.synced)} synced
              </Badge>
              <Badge
                variant={
                  (syncQueue.failed ?? 0) > 0 ? "destructive" : "secondary"
                }
              >
                <AlertCircle className="mr-1 size-3" aria-hidden />
                {fmt(syncQueue.failed)} failed
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              {syncQueue.available
                ? `Most recent activity: ${fmtDate(syncQueue.latestAt)}`
                : "No offline submissions recorded yet."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
