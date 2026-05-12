import Link from "next/link"
import { notFound } from "next/navigation"

import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { getEffectiveModulePermissionWithSource } from "@/lib/permissions/effective"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS, type ModuleKey } from "../../permissions/types"
import { EmployeeDetail, type EmployeeDetailData } from "./_components/employee-detail"

export const dynamic = "force-dynamic"

export const metadata = { title: "Employee | MFO / Rink Reports" }

type Params = Promise<{ id: string }>

export default async function EmployeeDetailPage({ params }: { params: Params }) {
  const { id } = await params
  await requireAdmin()

  const supabase = await createClient()

  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select(
      "id, facility_id, role_id, user_id, first_name, last_name, email, phone, is_active, is_minor, employee_code, hire_date, emergency_contact_name, emergency_contact_phone, created_at",
    )
    .eq("id", id)
    .maybeSingle()

  if (empErr) {
    return (
      <div className="p-6 text-sm text-red-600">
        Could not load employee: {empErr.message}
      </div>
    )
  }
  if (!emp) notFound()

  const [
    { data: rolesRaw },
    { data: deptsRaw },
    { data: empDeptsRaw },
    { data: groupsRaw },
    { data: memberRaw },
    { data: auditRaw },
  ] = await Promise.all([
    supabase
      .from("roles")
      .select("id, key, display_name, hierarchy_level")
      .eq("facility_id", emp.facility_id)
      .order("hierarchy_level", { ascending: true }),
    supabase
      .from("departments")
      .select("id, name, color")
      .eq("facility_id", emp.facility_id)
      .order("name", { ascending: true }),
    supabase
      .from("employee_departments")
      .select("department_id, is_primary")
      .eq("employee_id", emp.id),
    supabase
      .from("communication_groups")
      .select("id, name")
      .eq("facility_id", emp.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("communication_group_members")
      .select("id, group_id")
      .eq("employee_id", emp.id),
    supabase
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, created_at, actor_user_id")
      .or(`actor_employee_id.eq.${emp.id},entity_id.eq.${emp.id}`)
      .order("created_at", { ascending: false })
      .limit(25),
  ])

  const role =
    (rolesRaw ?? []).find((r) => r.id === emp.role_id) ?? null

  // Resolve effective permission + source per module.
  const moduleAccess = await Promise.all(
    (MODULE_KEYS as readonly ModuleKey[]).map(async (mod) => {
      const res = await getEffectiveModulePermissionWithSource(emp.id, mod)
      return { moduleKey: mod, ...res }
    }),
  )

  const data: EmployeeDetailData = {
    employee: {
      id: emp.id,
      facility_id: emp.facility_id,
      first_name: emp.first_name,
      last_name: emp.last_name,
      email: emp.email,
      phone: emp.phone,
      is_active: emp.is_active,
      is_minor: emp.is_minor,
      employee_code: emp.employee_code,
      hire_date: emp.hire_date,
      emergency_contact_name: emp.emergency_contact_name,
      emergency_contact_phone: emp.emergency_contact_phone,
      created_at: emp.created_at,
      role,
    },
    departments: (deptsRaw ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
    })),
    employeeDepartments: (empDeptsRaw ?? []).map((r) => ({
      department_id: r.department_id,
      is_primary: r.is_primary,
    })),
    groups: (groupsRaw ?? []).map((g) => ({ id: g.id, name: g.name })),
    memberships: (memberRaw ?? []).map((m) => ({
      id: m.id,
      group_id: m.group_id,
    })),
    moduleAccess,
    audit: (auditRaw ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      entity_type: a.entity_type,
      entity_id: a.entity_id,
      created_at: a.created_at,
    })),
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {emp.first_name} {emp.last_name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {role?.display_name ?? "No role"} ·{" "}
            {emp.email ?? <em>no email</em>} ·{" "}
            {emp.is_active ? "Active" : "Inactive"}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/employees">Back to employees</Link>
        </Button>
      </div>

      <EmployeeDetail data={data} />
    </div>
  )
}
