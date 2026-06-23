import { SignOutButton } from "@/components/staff/sign-out-button"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { SubmissionForm } from "./_components/submission-form"
import { computeFrequencyStatus, type FrequencyStatus } from "./_lib/compliance"
import {
  loadComplianceContext,
  type ComplianceContext,
} from "./_lib/load-compliance"
import type {
  ComplianceRuleForForm,
  EquipmentForForm,
  LocationOption,
  ReadingTypeForm,
} from "./types"

/** Serializable compliance context handed to the client form. */
export type FormComplianceContext = {
  jurisdiction: string
  displayName: string
  isBinding: boolean
  method: ComplianceContext["method"]
  guidanceNote: string | null
  metrics: ComplianceContext["metrics"]
  effectiveTiers: ComplianceContext["effectiveTiers"]
  twaSamples: number
  escalation: Record<string, string>
}

/** Start of the current ISO week (Monday 00:00 UTC). */
function weekStartIso(): string {
  const d = new Date()
  const day = (d.getUTCDay() + 6) % 7 // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

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
          { label: "Air Quality" },
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

export default async function AirQualityHomePage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id, first_name, last_name")
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

  if (!(await currentUserCan(supabase, "air_quality", "submit"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to submit air quality reports."
      />
    )
  }

  const nowIso = new Date().toISOString()

  const [
    { data: locationsRaw },
    { data: readingTypesRaw },
    { data: equipmentRaw },
    { data: settingsRow },
    { data: rulesRaw },
  ] = await Promise.all([
    // Shared facility-areas list (same source as Incident/Accident Reports).
    supabase
      .from("facility_spaces")
      .select("id, name, slug, sort_order, is_active")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("air_quality_reading_types")
      .select("id, key, label, unit, decimals, is_required, sort_order")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
    supabase
      .from("air_quality_equipment")
      .select("id, name, location_id, sort_order")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("air_quality_settings")
      .select("default_jurisdiction, alerts_enabled")
      .eq("facility_id", employeeRow.facility_id)
      .maybeSingle(),
    supabase
      .from("air_quality_compliance_rules")
      .select(
        "id, rule_name, rule_body, jurisdiction, is_active, effective_from, effective_to, sort_order"
      )
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])

  const locations: LocationOption[] = (locationsRaw ?? []).map((l) => ({
    id: l.id,
    name: l.name,
  }))

  if (locations.length === 0) {
    return (
      <NotAvailable
        title="Not configured yet"
        description="Air quality reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

  const readingTypes: ReadingTypeForm[] = (readingTypesRaw ?? []).map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    unit: r.unit,
    decimals: r.decimals,
    is_required: r.is_required,
    sort_order: r.sort_order,
  }))

  const equipment: EquipmentForForm[] = (equipmentRaw ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    location_id: e.location_id,
  }))

  const jurisdiction = settingsRow?.default_jurisdiction ?? null
  const rules: ComplianceRuleForForm[] = (rulesRaw ?? [])
    .filter((r) => {
      if (jurisdiction && r.jurisdiction !== jurisdiction) return false
      if (r.effective_from && r.effective_from > nowIso) return false
      if (r.effective_to && r.effective_to < nowIso) return false
      return true
    })
    .map((r) => ({
      id: r.id,
      rule_name: r.rule_name,
      rule_body: r.rule_body,
    }))

  // Jurisdiction-aware compliance context + this-week frequency status.
  const complianceCtx = await loadComplianceContext(
    supabase,
    employeeRow.facility_id,
  )
  let frequency: FrequencyStatus | null = null
  let formCompliance: FormComplianceContext | null = null
  if (complianceCtx.profile) {
    const { data: weekReports } = await supabase
      .from("air_quality_reports")
      .select("submitted_at")
      .eq("facility_id", employeeRow.facility_id)
      .gte("submitted_at", weekStartIso())
    let completedWeekday = 0
    let completedWeekend = 0
    for (const r of weekReports ?? []) {
      const dow = new Date(r.submitted_at).getUTCDay()
      if (dow === 0 || dow === 6) completedWeekend++
      else completedWeekday++
    }
    frequency = computeFrequencyStatus({
      rules: complianceCtx.samplingRules,
      completedWeekday,
      completedWeekend,
    })
    formCompliance = {
      jurisdiction: complianceCtx.profile.jurisdiction,
      displayName: complianceCtx.profile.display_name,
      isBinding: complianceCtx.profile.is_binding,
      method: complianceCtx.method,
      guidanceNote: complianceCtx.profile.guidance_note,
      metrics: complianceCtx.metrics,
      effectiveTiers: complianceCtx.effectiveTiers,
      twaSamples: complianceCtx.samplingRules.twa?.samples ?? 13,
      escalation: complianceCtx.escalation,
    }
  }

  const fullName = [employeeRow.first_name, employeeRow.last_name]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" ")
    .trim()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="air"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Air Quality" },
            ]}
          />
        }
        eyebrow="Air quality reading"
        title="Air Quality"
        description={`Submitting as ${fullName || "you"}. After you submit, the report can't be edited.`}
      />

      <SubmissionForm
        locations={locations}
        readingTypes={readingTypes}
        equipment={equipment}
        complianceRules={rules}
        compliance={formCompliance}
        frequency={frequency}
      />
    </div>
  )
}
