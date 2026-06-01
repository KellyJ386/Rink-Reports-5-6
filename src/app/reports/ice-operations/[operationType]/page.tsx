import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { TabNav } from "@/components/ui/tab-nav"
import { getIsAdmin, requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { getCurrentTempForFacility } from "@/lib/weather/current-temp"

import { BladeChangeForm } from "./_components/blade-change-form"
import { CircleCheckForm } from "./_components/circle-check-form"
import { EdgingForm } from "./_components/edging-form"
import { IceMakeForm } from "./_components/ice-make-form"
import {
  IceOpsShell,
  type RecentActivityItem,
} from "./_components/ice-ops-shell"
import {
  OPERATION_DESCRIPTIONS,
  OPERATION_EQUIPMENT_TYPE,
  OPERATION_LABELS,
  OPERATION_REQUIRES_RINK,
  OPERATION_TAB_ORDER,
  isOperationType,
  type EquipmentType,
  type OperationType,
} from "../types"

export const dynamic = "force-dynamic"

const CONFIGURE_HREF = "/admin/ice-operations?tab=setup"

const FORM_TITLES: Record<OperationType, string> = {
  ice_make: "Resurface Activity",
  blade_change: "Blade Change",
  edging: "Edging",
  circle_check: "Digital Circle Check",
}

type RouteParams = {
  operationType: string
}

function TabsNav({ active }: { active: OperationType }) {
  return (
    <TabNav
      ariaLabel="Ice operation"
      activeHref={`/reports/ice-operations/${active}`}
      items={OPERATION_TAB_ORDER.map((op) => ({
        label: OPERATION_LABELS[op],
        href: `/reports/ice-operations/${op}`,
      }))}
    />
  )
}

/** Bare layout for states where we can't load the full module shell. */
function MinimalNotice({
  title,
  description,
  showSignOut = false,
}: {
  title: string
  description: string
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Ice Operations
        </h1>
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
      <MinimalNotice
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "ice_operations", "submit"))) {
    return (
      <MinimalNotice
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
    { data: facilityRow },
    { data: recentRaw },
    isAdmin,
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
      .from("facilities")
      .select("name, city, state, zip_code")
      .eq("id", facilityId)
      .maybeSingle(),
    supabase
      .from("ice_operations_submissions")
      .select(
        "id, operation_type, occurred_at, submitted_at, failed_count, ice_operations_rinks(name), ice_operations_equipment(name)"
      )
      .eq("facility_id", facilityId)
      .order("submitted_at", { ascending: false })
      .limit(8),
    getIsAdmin(current),
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

  const facilityName = facilityRow?.name ?? null
  const temp = facilityRow
    ? await getCurrentTempForFacility({
        city: facilityRow.city,
        state: facilityRow.state,
        zip_code: facilityRow.zip_code,
      })
    : null

  type RecentDbRow = {
    id: string
    operation_type: string
    occurred_at: string
    submitted_at: string | null
    failed_count: number | null
    ice_operations_rinks: { name: string } | null
    ice_operations_equipment: { name: string } | null
  }
  const recent: RecentActivityItem[] = (
    (recentRaw ?? []) as unknown as RecentDbRow[]
  ).map((s) => ({
    id: s.id,
    label: isOperationType(s.operation_type)
      ? OPERATION_LABELS[s.operation_type]
      : s.operation_type,
    when: s.submitted_at ?? s.occurred_at,
    rinkName: s.ice_operations_rinks?.name ?? null,
    equipmentName: s.ice_operations_equipment?.name ?? null,
    failedCount: s.failed_count ?? 0,
  }))

  const shell = (
    <IceOpsShell
      userName={current.profile?.full_name ?? current.authUser.email ?? "User"}
      facilityName={facilityName}
      tempF={temp?.tempF ?? null}
      tempLocation={temp?.location ?? null}
      isAdmin={isAdmin}
      configureHref={CONFIGURE_HREF}
      recent={recent}
    />
  )

  const renderShellLayout = (content: ReactNode) => (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      {shell}
      <TabsNav active={operationType} />
      {content}
    </div>
  )

  const noticeCard = (title: string, description: string) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  )

  // Empty-state guards (rendered inside the full module shell).
  if (OPERATION_REQUIRES_RINK[operationType] && rinks.length === 0) {
    return renderShellLayout(
      noticeCard(
        "No rinks configured",
        "An administrator hasn't configured any rinks for this facility yet.",
      ),
    )
  }

  if (equipment.length === 0) {
    return renderShellLayout(
      noticeCard(
        "No machines configured",
        `No ${equipmentType.replace("_", " ")} equipment is set up yet. Talk to your administrator.`,
      ),
    )
  }

  // Operation-specific extra data.
  let circleCheckItems: {
    id: string
    label: string
    applies_to_equipment_type: string | null
  }[] = []
  let fuelTypes: { id: string; name: string }[] = []
  let templates: { id: string; name: string; fuel_type_id: string }[] = []
  let templateItems: { id: string; template_id: string; label: string }[] = []

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

    fuelTypes = (fuelsRes.data ?? []).map(
      (f: { id: string; name: string }) => ({
        id: f.id,
        name: f.name,
      }),
    )

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

    const hasAnyTemplateItems = templateItems.length > 0
    if (circleCheckItems.length === 0 && !hasAnyTemplateItems) {
      return renderShellLayout(
        noticeCard(
          "No checklist items",
          "An administrator hasn't configured any circle check items or templates yet.",
        ),
      )
    }
  }

  return renderShellLayout(
    <Card>
      <CardHeader>
        <CardTitle>{FORM_TITLES[operationType]}</CardTitle>
        <CardDescription>
          {OPERATION_DESCRIPTIONS[operationType]} You can&apos;t edit this after
          submitting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {operationType === "ice_make" ? (
          <IceMakeForm rinks={rinks} equipment={equipment} />
        ) : null}
        {operationType === "edging" ? (
          <EdgingForm equipment={equipment} />
        ) : null}
        {operationType === "blade_change" ? (
          <BladeChangeForm
            equipment={equipment}
            currentEmployeeId={employeeRow.id}
          />
        ) : null}
        {operationType === "circle_check" ? (
          <CircleCheckForm
            equipment={equipment}
            checklistItems={circleCheckItems}
            fuelTypes={fuelTypes}
            templates={templates}
            templateItems={templateItems}
          />
        ) : null}
      </CardContent>
    </Card>,
  )
}
