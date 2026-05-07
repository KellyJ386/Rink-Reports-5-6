import Link from "next/link"

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

import { SubmissionForm } from "./_components/submission-form"
import type { BodyPartOption, DropdownOption } from "./types"

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
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Accident Reports
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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "accident_reports")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return (
      <NotAvailable
        title="No access"
        description="You don't have permission to submit accident reports."
      />
    )
  }

  const [
    { data: dropdownRowsRaw },
    { data: workersCompRow },
    { data: userRow },
    { data: facility },
  ] = await Promise.all([
    supabase
      .from("accident_dropdowns")
      .select("id, category, key, display_name, color, sort_order, metadata")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
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
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Accident Reports
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Report an accident
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You can edit a submission for up to 24 hours after you submit it.
        </p>
      </div>

      <SubmissionForm
        defaultInjuredName={userRow?.full_name ?? ""}
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
        <section className="mt-2 flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Your recent submissions
          </h2>
          <p className="text-xs text-muted-foreground">Last 30 days</p>
          <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
            {recent.map((r) => {
              const severityName = r.severity?.display_name ?? null
              const severityColor = r.severity?.color ?? null
              const medical = r.medical?.display_name ?? null
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/reports/accidents/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.injured_person_name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(r.submitted_at, tz)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {severityName ? (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={
                          severityColor
                            ? {
                                backgroundColor: `${severityColor}20`,
                                color: severityColor,
                              }
                            : undefined
                        }
                      >
                        {severityName}
                      </span>
                    ) : null}
                    {medical ? (
                      <span className="text-xs text-muted-foreground">
                        Medical: {medical}
                      </span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
