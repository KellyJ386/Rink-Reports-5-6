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
import { IceOperationsControls } from "./_components/ice-operations-controls"
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
      <IceOperationsControls activeOperation={operationType} />
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("ice_operations_equipment")
      .select(
        "id, name, equipment_type, hours_count, sort_order, is_active, fuel_type_id"
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
  type EquipmentDbRow = {
    id: string
    name: string
    equipment_type: string
    hours_count: number | null
    fuel_type_id: string | null
  }
  const equipment = ((equipmentRaw ?? []) as EquipmentDbRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    equipment_type: row.equipment_type as EquipmentType,
    hours_count: row.hours_count,
    fuel_type_id: row.fuel_type_id ?? null,
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
  let fuelTypes: { id: string; name: string }[] = []
  let templates: { id: string; name: string; fuel_type_id: string }[] = []
  let templateItems: { id: string; template_id: string; label: string }[] = []
  let employees: { id: string; name: string }[] = []

  if (operationType === "circle_check") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const [itemsRes, fuelsRes, tmplRes, tmplItemsRes] = await Promise.all([
      supabase
        .from("ice_operations_circle_check_items")
        .select("id, label, applies_to_equipment_type, sort_order, is_active")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .or(
          `applies_to_equipment_type.is.null,applies_to_equipment_type.eq.${equipmentType}`,
        )
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true }),
      sb
        .from("ice_operations_fuel_types")
        .select("id, name")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      sb
        .from("ice_operations_circle_check_templates")
        .select("id, name, fuel_type_id, is_active")
        .eq("facility_id", facilityId)
        .eq("is_active", true),
      sb
        .from("ice_operations_circle_check_template_items")
        .select("id, template_id, label, sort_order, is_active")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ])

    circleCheckItems = (itemsRes.data ?? []).map(
      (i: {
        id: string
        label: string
        applies_to_equipment_type: string | null
      }) => ({
        id: i.id,
        label: i.label,
        applies_to_equipment_type: i.applies_to_equipment_type,
      }),
    )

    fuelTypes = (fuelsRes.data ?? []).map((f: { id: string; name: string }) => ({
      id: f.id,
      name: f.name,
    }))

    templates = (tmplRes.data ?? []).map(
      (t: { id: string; name: string; fuel_type_id: string }) => ({
        id: t.id,
        name: t.name,
        fuel_type_id: t.fuel_type_id,
      }),
    )

    templateItems = (tmplItemsRes.data ?? []).map(
      (i: { id: string; template_id: string; label: string }) => ({
        id: i.id,
        template_id: i.template_id,
        label: i.label,
      }),
    )

    // Operator can proceed if either legacy items OR at least one template
    // with fields exists. Equipment without a fuel-type binding will fall
    // back to legacy items.
    const hasAnyTemplateItems = templateItems.length > 0
    if (circleCheckItems.length === 0 && !hasAnyTemplateItems) {
      return (
        <NotAvailable
          operationType={operationType}
          title="No checklist items"
          description="An administrator hasn't configured any circle check items or templates yet."
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
      </div>

      <IceOperationsControls
        activeOperation={operationType}
        facilityId={facilityId}
        rinks={rinks}
      />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {OPERATION_LABELS[operationType]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {OPERATION_DESCRIPTIONS[operationType]} You can&apos;t edit this
          after submitting.
        </p>
      </div>

      {operationType === "ice_make" ? (
        <IceMakeForm
          facilityId={facilityId}
          rinks={rinks}
          equipment={equipment}
          temperatureUnit={tempUnit}
        />
      ) : null}
      {operationType === "edging" ? (
        <EdgingForm
          facilityId={facilityId}
          rinks={rinks}
          equipment={equipment}
        />
      ) : null}
      {operationType === "blade_change" ? (
        <BladeChangeForm
          facilityId={facilityId}
          rinks={rinks}
          equipment={equipment}
          employees={employees}
          currentEmployeeId={employeeRow.id}
        />
      ) : null}
      {operationType === "circle_check" ? (
        <CircleCheckForm
          facilityId={facilityId}
          rinks={rinks}
          equipment={equipment}
          checklistItems={circleCheckItems}
          fuelTypes={fuelTypes}
          templates={templates}
          templateItems={templateItems}
        />
      ) : null}
    </div>
  )
}
