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

  const DISPLAY_FONT =
    "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
  const NAVY = "#003B6F"
  const NAVY_LIGHT = "#0055A3"
  const GREEN = "#4DFF00"
  const GREY = "#A5ACAF"
  const LINE = "#e5e7eb"
  const RED = "#F42A2A"

  return (
    <div
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "24px 16px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Breadcrumb + header */}
      <div>
        <p style={{ fontSize: 12, color: GREY, marginBottom: 12 }}>
          <Link
            href="/reports"
            style={{ color: GREY, textDecoration: "none" }}
          >
            Reports
          </Link>
          {" / Accident Reports"}
        </p>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: ".16em",
                color: RED,
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              Staff report
            </div>
            <h1
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: "clamp(30px, 6vw, 44px)",
                lineHeight: 1,
                letterSpacing: "0.01em",
                textTransform: "uppercase",
                color: NAVY,
                margin: 0,
              }}
            >
              Accident Report
            </h1>
          </div>
        </div>
        <p
          style={{
            fontSize: 13,
            color: GREY,
            marginTop: 8,
          }}
        >
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
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".16em",
              color: GREY,
              textTransform: "uppercase",
            }}
          >
            Your recent submissions · last 30 days
          </div>
          <div
            style={{
              background: "#fff",
              border: `1px solid ${LINE}`,
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            }}
          >
            {recent.map((r, i) => {
              const severityName = r.severity?.display_name ?? null
              const severityColor = r.severity?.color ?? null
              const medical = r.medical?.display_name ?? null
              return (
                <Link
                  key={r.id}
                  href={`/reports/accidents/${r.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderBottom:
                      i < recent.length - 1 ? `1px solid ${LINE}` : "none",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {/* Severity dot */}
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 9999,
                      background: severityColor ?? GREY,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
                      {r.injured_person_name || "—"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginTop: 3,
                        alignItems: "center",
                      }}
                    >
                      {severityName ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 9999,
                            background: severityColor
                              ? `${severityColor}20`
                              : "#f3f4f6",
                            color: severityColor ?? GREY,
                            letterSpacing: ".04em",
                            textTransform: "uppercase",
                          }}
                        >
                          {severityName}
                        </span>
                      ) : null}
                      {medical ? (
                        <span style={{ fontSize: 11.5, color: GREY }}>
                          {medical}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: GREY,
                      flexShrink: 0,
                      textAlign: "right",
                    }}
                  >
                    {formatTimestamp(r.submitted_at, tz)}
                  </div>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={GREY}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}
