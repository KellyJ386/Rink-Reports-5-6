import Link from "next/link"
import { redirect } from "next/navigation"

import { SignOutButton } from "@/components/staff/sign-out-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type SearchParams = {
  id?: string | string[]
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

export default async function DailyReportDonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireUser()
  const sp = await searchParams
  const idParam = Array.isArray(sp.id) ? sp.id[0] : sp.id

  if (!idParam) {
    redirect("/reports/daily")
  }

  const supabase = await createClient()

  const { data: submission } = await supabase
    .from("daily_report_submissions")
    .select(
      "id, submitted_at, area_id, template_id, facility_id, daily_report_areas(name, slug), daily_report_templates(name)"
    )
    .eq("id", idParam)
    .maybeSingle()

  if (!submission) {
    redirect("/reports/daily")
  }

  const { data: itemRows } = await supabase
    .from("daily_report_submission_items")
    .select("id, is_checked")
    .eq("submission_id", submission.id)

  const total = itemRows?.length ?? 0
  const checkedCount = (itemRows ?? []).filter((r) => r.is_checked).length

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", submission.facility_id)
    .maybeSingle()

  const areaName =
    submission.daily_report_areas?.name ?? "Area"
  const templateName =
    submission.daily_report_templates?.name ?? "Template"

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div
            aria-hidden
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Submitted!</h1>
          <p className="text-sm text-muted-foreground">
            {areaName} · {templateName}
          </p>
          <p className="text-sm">
            {formatTimestamp(submission.submitted_at, facility?.timezone ?? null)}
          </p>
          {total > 0 ? (
            <p className="text-sm">
              <span className="font-medium">{checkedCount}</span> of{" "}
              <span className="font-medium">{total}</span> items checked
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No checklist items recorded.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 w-full text-base sm:flex-1">
          <Link href="/reports/daily">Submit another</Link>
        </Button>
        <SignOutButton className="sm:flex-1" />
      </div>
    </div>
  )
}
