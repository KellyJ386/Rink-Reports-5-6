import { SignOutButton } from "@/components/staff/sign-out-button"
import { Badge } from "@/components/ui/badge"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataList, DataListRow } from "@/components/ui/data-table"
import { requireUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { createClient } from "@/lib/supabase/server"
import { getCurrentTempForFacility } from "@/lib/weather/current-temp"

import { SubmissionForm } from "./_components/submission-form"
import type {

  RefrigerationEquipment,
  RefrigerationField,
  RefrigerationFieldOption,
  RefrigerationFieldType,
  RefrigerationSection,
  RefrigerationThreshold,
} from "./types"

export const dynamic = "force-dynamic"

function NotAvailable({
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
      <Breadcrumb
        segments={[
          { label: "Reports", href: "/reports" },
          { label: "Refrigeration" },
        ]}
      />
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

type FieldOptionShape = {
  key?: unknown
  label?: unknown
}

function parseFieldOptions(value: unknown): RefrigerationFieldOption[] {
  if (!Array.isArray(value)) return []
  const out: RefrigerationFieldOption[] = []
  for (const raw of value as FieldOptionShape[]) {
    if (!raw || typeof raw !== "object") continue
    const k = typeof raw.key === "string" ? raw.key : null
    const l = typeof raw.label === "string" ? raw.label : null
    if (k && l) out.push({ key: k, label: l })
  }
  return out
}

function isFieldType(t: string): t is RefrigerationFieldType {
  return (
    t === "numeric" ||
    t === "text" ||
    t === "boolean" ||
    t === "select" ||
    t === "computed"
  )
}

export default async function RefrigerationHomePage() {
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
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "refrigeration", "submit"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to submit refrigeration reports."
      />
    )
  }

  const [
    { data: sectionsRaw },
    { data: equipmentRaw },
    { data: fieldsRaw },
    { data: thresholdsRaw },
    { data: settingsRow },
    { data: facility },
  ] = await Promise.all([
    supabase
      .from("refrigeration_sections")
      .select("id, name, sort_order, is_active, facility_id")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("refrigeration_equipment")
      .select("id, section_id, name, sort_order, is_active, facility_id")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("section_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("refrigeration_fields")
      .select(
        "id, section_id, equipment_id, label, field_type, unit, options, sort_order, is_active, facility_id"
      )
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("section_id", { ascending: true })
      .order("equipment_id", { ascending: true, nullsFirst: true })
      .order("sort_order", { ascending: true }),
    supabase
      .from("refrigeration_thresholds")
      .select(
        "id, field_id, equipment_id, min_value, max_value, severity, is_active, facility_id"
      )
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true),
    supabase
      .from("refrigeration_settings")
      .select("out_of_range_alerts_enabled")
      .eq("facility_id", employeeRow.facility_id)
      .maybeSingle(),
    supabase
      .from("facilities")
      .select("name, timezone, city, state, zip_code")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
  ])

  const sections = (sectionsRaw ?? []) as Pick<
    RefrigerationSection,
    "id" | "name" | "sort_order" | "is_active" | "facility_id"
  >[]
  const equipment = (equipmentRaw ?? []) as Pick<
    RefrigerationEquipment,
    "id" | "section_id" | "name" | "sort_order" | "is_active" | "facility_id"
  >[]
  const fields = (fieldsRaw ?? []) as Pick<
    RefrigerationField,
    | "id"
    | "section_id"
    | "equipment_id"
    | "label"
    | "field_type"
    | "unit"
    | "options"
    | "sort_order"
    | "is_active"
    | "facility_id"
  >[]

  if (sections.length === 0 || fields.length === 0) {
    return (
      <NotAvailable
        title="Not configured yet"
        description="Refrigeration reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

  // Recent submissions in last 30 days. RLS scopes to this submitter.
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const { data: recentReportsRaw } = await supabase
    .from("refrigeration_reports")
    .select("id, submitted_at")
    .eq("employee_id", employeeRow.id)
    .gte("submitted_at", since.toISOString())
    .order("submitted_at", { ascending: false })
    .limit(10)

  const recentReports = recentReportsRaw ?? []

  let recentValueCounts: Record<string, { total: number; oor: number }> = {}
  if (recentReports.length > 0) {
    const reportIds = recentReports.map((r) => r.id)
    const { data: valuesRaw } = await supabase
      .from("refrigeration_report_values")
      .select("report_id, is_out_of_range")
      .in("report_id", reportIds)
    recentValueCounts = (valuesRaw ?? []).reduce<
      Record<string, { total: number; oor: number }>
    >((acc, row) => {
      const existing = acc[row.report_id] ?? { total: 0, oor: 0 }
      existing.total += 1
      if (row.is_out_of_range) existing.oor += 1
      acc[row.report_id] = existing
      return acc
    }, {})
  }

  const tz = facility?.timezone ?? null

  const thresholds = (thresholdsRaw ?? []) as Pick<
    RefrigerationThreshold,
    "field_id" | "equipment_id" | "min_value" | "max_value" | "severity"
  >[]

  // Same precedence as the server matcher (_lib/submit lookupThreshold):
  // an equipment-specific threshold wins, otherwise the section-level one.
  function resolveRange(fieldId: string, equipmentId: string | null) {
    const t =
      (equipmentId
        ? thresholds.find(
            (x) => x.field_id === fieldId && x.equipment_id === equipmentId
          )
        : undefined) ??
      thresholds.find((x) => x.field_id === fieldId && x.equipment_id === null)
    return {
      normalMin: t?.min_value ?? null,
      normalMax: t?.max_value ?? null,
      // Surfaced so the form can require a corrective-action note when a
      // critical-severity threshold is breached (server re-validates).
      severity: (t?.severity ?? null) as "warn" | "high" | "critical" | null,
    }
  }

  const formSections = sections.map((s) => {
    const sectionEquipment = equipment.filter((e) => e.section_id === s.id)
    const sectionFields = fields.filter((f) => f.section_id === s.id)
    return {
      id: s.id,
      name: s.name,
      sectionLevelFields: sectionFields
        .filter((f) => f.equipment_id === null)
        .map((f) => ({
          id: f.id,
          equipment_id: null as string | null,
          label: f.label,
          field_type: isFieldType(f.field_type) ? f.field_type : "text",
          unit: f.unit,
          // is_required was added in migration 64 and isn't in generated
          // types yet. Falls back to false for pre-migration rows.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          is_required: Boolean((f as any).is_required),
          options: parseFieldOptions(f.options),
          ...resolveRange(f.id, null),
        })),
      equipment: sectionEquipment.map((e) => ({
        id: e.id,
        name: e.name,
        fields: sectionFields
          .filter((f) => f.equipment_id === e.id)
          .map((f) => ({
            id: f.id,
            equipment_id: e.id,
            label: f.label,
            field_type: isFieldType(f.field_type) ? f.field_type : "text",
            unit: f.unit,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            is_required: Boolean((f as any).is_required),
            options: parseFieldOptions(f.options),
            ...resolveRange(f.id, e.id),
          })),
      })),
    }
  })

  const oorAlertsEnabled = Boolean(
    settingsRow?.out_of_range_alerts_enabled ?? false
  )

  const temp = facility
    ? await getCurrentTempForFacility({
        city: facility.city,
        state: facility.state,
        zip_code: facility.zip_code,
      })
    : null

  const userName =
    current.profile?.full_name ??
    current.profile?.email ??
    current.authUser.email ??
    "Unknown user"

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <SubmissionForm
        sections={formSections}
        oorAlertsEnabled={oorAlertsEnabled}
        userName={userName}
        facilityName={facility?.name ?? "Facility"}
        tempF={temp?.tempF ?? null}
        tempLocation={temp?.location ?? null}
      />

      {recentReports.length > 0 ? (
        <section className="mt-2 flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Your recent submissions
          </h2>
          <p className="text-xs text-muted-foreground">Last 30 days</p>
          <DataList>
            {recentReports.map((r) => {
              const counts = recentValueCounts[r.id] ?? { total: 0, oor: 0 }
              return (
                <DataListRow key={r.id} as="div">
                  <span className="flex-1 text-xs text-muted-foreground">
                    {formatTimestamp(r.submitted_at, tz)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {counts.total} value{counts.total === 1 ? "" : "s"}
                    </Badge>
                    {counts.oor > 0 ? (
                      <Badge variant="warning">{counts.oor} out-of-range</Badge>
                    ) : null}
                  </span>
                </DataListRow>
              )
            })}
          </DataList>
        </section>
      ) : null}
    </div>
  )
}

function formatTimestamp(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return new Date(iso).toLocaleString()
  }
}
