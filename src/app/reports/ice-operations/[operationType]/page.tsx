import Link from "next/link"
import { notFound } from "next/navigation"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { BladeChangeForm } from "./_components/blade-change-form"
import { CircleCheckForm } from "./_components/circle-check-form"
import { EdgingForm } from "./_components/edging-form"
import { IceMakeForm } from "./_components/ice-make-form"
import {

  OPERATION_DESCRIPTIONS,
  OPERATION_EQUIPMENT_TYPE,
  OPERATION_LABELS,
  isOperationType,
  type EquipmentType,
  type OperationType,
  type TemperatureUnit,
} from "../types"

export const dynamic = "force-dynamic"

type RouteParams = {
  operationType: string
}

function NotAvailable({
  operationType,
  title,
  description,
  showSignOut = false,
}: {
  operationType: OperationType | null
  title: string
  description: string
  showSignOut?: boolean
}) {
  const breadcrumbLabel = operationType
    ? OPERATION_LABELS[operationType]
    : "Ice Operations"
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          /{" "}
          <Link href="/reports/ice-operations" className="hover:underline">
            Ice Operations
          </Link>
          {operationType ? ` / ${breadcrumbLabel}` : ""}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}

export default async function OperationTypePage({
  params,
}: {
  params: Promise<RouteParams>
}) {
  const { operationType: opTypeRaw } = await params
  if (!isOperationType(opTypeRaw)) {
    notFound()
  }
  const operationType = opTypeRaw as OperationType

  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <NotAvailable
        operationType={operationType}
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "ice_operations")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return (
      <NotAvailable
        operationType={operationType}
        title="No permission"
        description="You don't have permission to submit ice operations reports."
      />
    )
  }

  const facilityId = employeeRow.facility_id
  const equipmentType = OPERATION_EQUIPMENT_TYPE[operationType]

  const [
    { data: rinksRaw },
    { data: equipmentRaw },
    { data: settingsRow },
  ] = await Promise.all([
    supabase
      .from("ice_operations_rinks")
      .select("id, name, sort_order, is_active")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_operations_equipment")
      .select(
        "id, name, equipment_type, hours_count, sort_order, is_active"
      )
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .eq("equipment_type", equipmentType)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("ice_operations_settings")
      .select("temperature_unit, alerts_enabled, default_alert_severity")
      .eq("facility_id", facilityId)
      .maybeSingle(),
  ])

  const rinks = (rinksRaw ?? []).map((r) => ({ id: r.id, name: r.name }))
  const equipment = (equipmentRaw ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    equipment_type: e.equipment_type as EquipmentType,
    hours_count: e.hours_count,
  }))

  const tempUnit: TemperatureUnit =
    settingsRow?.temperature_unit === "F" ? "F" : "C"

  // Empty state guards.
  if (rinks.length === 0) {
    return (
      <NotAvailable
        operationType={operationType}
        title="No rinks configured"
        description="An administrator hasn't configured any rinks for this facility yet."
      />
    )
  }

  if (equipment.length === 0) {
    return (
      <NotAvailable
        operationType={operationType}
        title="No equipment configured"
        description={`No ${equipmentType.replace("_", " ")} equipment is set up yet. Talk to your administrator.`}
      />
    )
  }

  // Operation-specific extra data.
  let circleCheckItems: { id: string; label: string; applies_to_equipment_type: string | null }[] = []
  let employees: { id: string; name: string }[] = []

  if (operationType === "circle_check") {
    const { data: itemsRaw } = await supabase
      .from("ice_operations_circle_check_items")
      .select(
        "id, label, applies_to_equipment_type, sort_order, is_active"
      )
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .or(
        `applies_to_equipment_type.is.null,applies_to_equipment_type.eq.${equipmentType}`
      )
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true })

    circleCheckItems = (itemsRaw ?? []).map((i) => ({
      id: i.id,
      label: i.label,
      applies_to_equipment_type: i.applies_to_equipment_type,
    }))

    if (circleCheckItems.length === 0) {
      return (
        <NotAvailable
          operationType={operationType}
          title="No checklist items"
          description="An administrator hasn't configured any circle check items yet."
        />
      )
    }
  }

  if (operationType === "blade_change") {
    const { data: empsRaw } = await supabase
      .from("employees")
      .select("id, first_name, last_name, is_active")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true })

    employees = (empsRaw ?? []).map((e) => {
      const name = [e.first_name, e.last_name].filter(Boolean).join(" ").trim()
      return { id: e.id, name: name || "Employee" }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          /{" "}
          <Link href="/reports/ice-operations" className="hover:underline">
            Ice Operations
          </Link>{" "}
          / {OPERATION_LABELS[operationType]}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {OPERATION_LABELS[operationType]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {OPERATION_DESCRIPTIONS[operationType]} You can&apos;t edit this
          after submitting.
        </p>
      </div>

      {operationType === "ice_make" ? (
        <IceMakeForm
          rinks={rinks}
          equipment={equipment}
          temperatureUnit={tempUnit}
        />
      ) : null}
      {operationType === "edging" ? (
        <EdgingForm rinks={rinks} equipment={equipment} />
      ) : null}
      {operationType === "blade_change" ? (
        <BladeChangeForm
          rinks={rinks}
          equipment={equipment}
          employees={employees}
          currentEmployeeId={employeeRow.id}
        />
      ) : null}
      {operationType === "circle_check" ? (
        <CircleCheckForm
          rinks={rinks}
          equipment={equipment}
          checklistItems={circleCheckItems}
        />
      ) : null}
    </div>
  )
}
