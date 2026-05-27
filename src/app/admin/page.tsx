import Link from "next/link"
import {
  AlertTriangle,
  Building2,
  Check,
  Circle,
  FileText,
  Users,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("role_module_permission_defaults")
        .select("*", { count: "exact", head: true })
        .eq("facility_id", facilityIdStr)
        .neq("permission_level", "none") as Promise<{ count: number | null }>,
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

  // UTC midnight for "today" boundary
  const todayUtc = new Date()
  todayUtc.setUTCHours(0, 0, 0, 0)

  // Rolling 90-day window for the incident/accident count so the query stays
  // bounded (both tables grow unbounded over a facility's lifetime). Derived
  // from `todayUtc` (a `new Date()`, the same impure-read pattern the existing
  // "today" boundary above uses) rather than a fresh `Date.now()`.
  const ninetyDaysAgo = new Date(todayUtc)
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90)
  const ninetyDaysAgoIso = ninetyDaysAgo.toISOString()

  const [
    { count: facilityCount },
    { count: employeeCount },
    { count: dailyCount },
    { count: incidentCount },
    { count: accidentCount },
  ] = await Promise.all([
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
    activeFacilityId
      ? supabase
          .from("daily_report_submissions")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .gte("submitted_at", todayUtc.toISOString())
      : Promise.resolve({ count: null }),
    activeFacilityId
      ? supabase
          .from("incident_reports")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .gte("submitted_at", ninetyDaysAgoIso)
      : Promise.resolve({ count: null }),
    activeFacilityId
      ? supabase
          .from("accident_reports")
          .select("*", { count: "exact", head: true })
          .eq("facility_id", activeFacilityId)
          .gte("submitted_at", ninetyDaysAgoIso)
      : Promise.resolve({ count: null }),
  ])

  function fmt(n: number | null): string {
    if (n === null) return "—"
    return n.toLocaleString()
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
    {
      title: "Reports submitted today",
      value: fmt(dailyCount),
      description: "Daily report submissions for the current day.",
      icon: FileText,
    },
    {
      title: "Incidents & accidents",
      value: fmt(
        incidentCount !== null || accidentCount !== null
          ? (incidentCount ?? 0) + (accidentCount ?? 0)
          : null
      ),
      description: "Incident and accident reports in the last 90 days.",
      icon: AlertTriangle,
    },
  ]
  const visible = cards.filter((c) => !c.superAdminOnly || isSuperAdmin)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground text-sm">
            Setup status and operational overview for the selected facility.
          </p>
        </div>
        {isSuperAdmin && facilityOptions.length > 0 && (
          <FacilitySwitcher
            facilities={facilityOptions}
            activeFacilityId={activeFacilityId}
          />
        )}
      </div>

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
    </div>
  )
}
