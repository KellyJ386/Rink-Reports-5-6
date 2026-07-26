import Link from "next/link"

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
import { formatInTz } from "@/lib/timezone"
import { createClient } from "@/lib/supabase/server"

import { CorrectionForm } from "./correction-form"

export const dynamic = "force-dynamic"

export const metadata = { title: "File Correction | MFO / Rink Reports" }

/**
 * The paper-logbook correction path for staff: the ORIGINAL SUBMITTER of a
 * daily report (even one locked by day rollover) can file a correction that
 * supersedes it. The original is never edited; both versions stay on record.
 * Authorization is enforced by the supersede RPC (migration 215) — this page
 * additionally pre-checks ownership so non-owners get a clear message
 * instead of a form that will fail.
 */
export default async function CorrectSubmissionPage({
  params,
}: {
  params: Promise<{ submissionId: string }>
}) {
  const { submissionId } = await params
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  // RLS: the submitter always sees their own rows (migration 215).
  const { data: submission } = await supabase
    .from("daily_report_submissions")
    .select(
      "id, area_id, template_id, employee_id, submitted_at, business_date, superseded_at, supersedes_id"
    )
    .eq("id", submissionId)
    .maybeSingle()

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="daily"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Daily Reports", href: "/reports/daily" },
              { label: "History", href: "/reports/daily/history" },
              { label: "Correction" },
            ]}
          />
        }
        title="File a Correction"
        description="The original report is never edited or deleted — a correction supersedes it and both stay on record."
      />
      {children}
    </div>
  )

  const notAvailable = (why: string) =>
    shell(
      <Card>
        <CardHeader>
          <CardTitle>Correction not available</CardTitle>
          <CardDescription>{why}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-sm underline underline-offset-2" href="/reports/daily/history">
            Back to history
          </Link>
        </CardContent>
      </Card>
    )

  if (!employeeRow || !submission) {
    return notAvailable("This submission doesn't exist or isn't visible to you.")
  }
  if (submission.employee_id !== employeeRow.id) {
    return notAvailable(
      "Only the original submitter (or a daily-reports admin, via the admin console) can file a correction."
    )
  }
  if (submission.superseded_at) {
    return notAvailable(
      "This submission was already corrected. Correct the latest version instead."
    )
  }

  const [{ data: items }, { data: area }, { data: facility }] =
    await Promise.all([
      supabase
        .from("daily_report_submission_items")
        .select("id, checklist_item_id, label_snapshot, is_checked")
        .eq("submission_id", submission.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("daily_report_areas")
        .select("name")
        .eq("id", submission.area_id)
        .maybeSingle(),
      supabase
        .from("facilities")
        .select("timezone")
        .eq("id", employeeRow.facility_id)
        .maybeSingle(),
    ])

  return shell(
    <Card>
      <CardHeader>
        <CardTitle>
          {area?.name ?? "Daily report"} —{" "}
          {formatInTz(submission.submitted_at, facility?.timezone ?? null)}
        </CardTitle>
        <CardDescription>
          Adjust the item states and explain what was wrong. Your correction is
          recorded with your name and links back to the original.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CorrectionForm
          submissionId={submission.id}
          items={(items ?? []).map((it) => ({
            id: it.id,
            checklist_item_id: it.checklist_item_id,
            label_snapshot: it.label_snapshot,
            is_checked: it.is_checked,
          }))}
        />
      </CardContent>
    </Card>
  )
}
