import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataList, DataListRow } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { SeverityDot, SeverityPill } from "@/components/ui/severity"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { SubmissionForm } from "./_components/submission-form"
import { getAccidentDropdowns } from "./_lib/dropdowns"
import type { BodyPartOption, DropdownOption } from "./types"

export const dynamic = "force-dynamic"

type RecentRow = {
  id: string
  submitted_at: string
  injured_person_name: string
  severity: { display_name: string; color: string | null } | null
  medical: { display_name: string } | null
}

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
          { label: "Accident Reports" },
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

type DropdownRow = {
  id: string
  category: string
  key: string
  display_name: string
  color: string | null
  sort_order: number
  metadata: unknown
}

function partition(rows: DropdownRow[]): {
  locations: DropdownOption[]
  activities: DropdownOption[]
  severities: DropdownOption[]
  medicalAttentions: DropdownOption[]
  injuryTypes: DropdownOption[]
  bodyParts: BodyPartOption[]
} {
  const locations: DropdownOption[] = []
  const activities: DropdownOption[] = []
  const severities: DropdownOption[] = []
  const medicalAttentions: DropdownOption[] = []
  const injuryTypes: DropdownOption[] = []
  const bodyParts: BodyPartOption[] = []
  for (const r of rows) {
    const opt: DropdownOption = {
      id: r.id,
      key: r.key,
      display_name: r.display_name,
      color: r.color,
    }
    switch (r.category) {
      case "location":
        locations.push(opt)
        break
      case "activity":
        activities.push(opt)
        break
      case "severity":
        severities.push(opt)
        break
      case "medical_attention": {
        const triggersAlert: boolean = !!(
          r.metadata &&
          typeof r.metadata === "object" &&
          !Array.isArray(r.metadata) &&
          (r.metadata as Record<string, unknown>).triggers_alert === true
        )
        medicalAttentions.push({ ...opt, triggersAlert })
        break
      }
      case "injury_type":
        injuryTypes.push(opt)
        break
      case "body_part":
        bodyParts.push({
          id: r.id,
          key: r.key,
          display_name: r.display_name,
        })
        break
      default:
        break
    }
  }
  return {
    locations,
    activities,
    severities,
    medicalAttentions,
    injuryTypes,
    bodyParts,
  }
}

export default async function AccidentsHomePage() {
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
        title="Account not ready"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "accident_reports", "submit"))) {
    return (
      <NotAvailable
        title="No access"
        description="You don't have permission to submit accident reports."
      />
    )
  }

  const [
    dropdownRowsRaw,
    { data: workersCompRow },
    { data: userRow },
    { data: facility },
  ] = await Promise.all([
    getAccidentDropdowns(employeeRow.facility_id),
    supabase
      .from("accident_workers_comp_settings")
      .select("instructions, is_active")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("users")
      .select("full_name, phone")
      .eq("id", current.authUser.id)
      .maybeSingle(),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
  ])

  const dropdownRows = (dropdownRowsRaw ?? []) as DropdownRow[]
  const {
    locations,
    activities,
    severities,
    medicalAttentions,
    injuryTypes,
    bodyParts,
  } = partition(dropdownRows)

  if (
    severities.length === 0 ||
    medicalAttentions.length === 0 ||
    bodyParts.length === 0
  ) {
    return (
      <NotAvailable
        title="Not configured yet"
        description="Accident reporting isn't configured yet for this facility. Talk to your administrator."
      />
    )
  }

  // Recent submissions, last 30 days, RLS scopes to this submitter.
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const { data: recentRaw } = await supabase
    .from("accident_reports")
    .select(
      "id, submitted_at, injured_person_name, severity:severity_dropdown_id(display_name, color), medical:medical_attention_dropdown_id(display_name)"
    )
    .eq("employee_id", employeeRow.id)
    .gte("submitted_at", since.toISOString())
    .order("submitted_at", { ascending: false })
    .limit(10)

  const recent = (recentRaw ?? []) as unknown as RecentRow[]
  const tz = facility?.timezone ?? null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="accidents"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Accident Reports" },
            ]}
          />
        }
        title="Accident Reports"
      />

      <SubmissionForm
        defaultInjuredName=""
        defaultInjuredContact={userRow?.phone ?? ""}
        locations={locations}
        activities={activities}
        severities={severities}
        medicalAttentions={medicalAttentions}
        injuryTypes={injuryTypes}
        bodyParts={bodyParts}
        workersCompInstructions={workersCompRow?.instructions ?? null}
      />

      {recent.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Your recent submissions · last 30 days
          </h2>
          <DataList>
            {recent.map((r) => {
              const severityName = r.severity?.display_name ?? null
              const severityColor = r.severity?.color ?? null
              const medical = r.medical?.display_name ?? null
              return (
                <DataListRow key={r.id} href={`/reports/accidents/${r.id}`}>
                  <SeverityDot color={severityColor} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">
                      {r.injured_person_name || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {severityName ? (
                        <SeverityPill color={severityColor}>
                          {severityName}
                        </SeverityPill>
                      ) : null}
                      {medical ? (
                        <span className="text-xs text-muted-foreground">
                          {medical}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    {formatTimestamp(r.submitted_at, tz)}
                  </div>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </DataListRow>
              )
            })}
          </DataList>
          <div>
            <Button asChild variant="link" size="sm">
              <Link href="/reports">Back to reports</Link>
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
