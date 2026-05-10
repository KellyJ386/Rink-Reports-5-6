import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type SearchParams = {
  id?: string | string[]
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function severityClass(severity: string | null): string {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200"
    case "high":
      return "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200"
    case "warn":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
    default:
      return "bg-muted text-foreground"
  }
}

export default async function AirQualityDonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireUser()
  const sp = await searchParams
  const idParam = Array.isArray(sp.id) ? sp.id[0] : sp.id

  if (!idParam || !UUID_RE.test(idParam)) {
    redirect("/reports/air-quality")
  }

  const supabase = await createClient()

  const { data: report } = await supabase
    .from("air_quality_reports")
    .select(
      "id, submitted_at, facility_id, location_id, has_exceedance, max_severity"
    )
    .eq("id", idParam)
    .maybeSingle()

  if (!report) {
    redirect("/reports/air-quality")
  }

  const [{ data: facility }, { data: location }, { data: readingRows }] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("timezone")
        .eq("id", report.facility_id)
        .maybeSingle(),
      supabase
        .from("air_quality_locations")
        .select("name")
        .eq("id", report.location_id)
        .maybeSingle(),
      supabase
        .from("air_quality_readings")
        .select("id, is_exceedance")
        .eq("report_id", report.id),
    ])

  const tz = facility?.timezone ?? null
  const readingsCount = readingRows?.length ?? 0
  const exceedanceCount = (readingRows ?? []).filter(
    (r) => r.is_exceedance
  ).length

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
          {location?.name ? (
            <p className="text-sm font-medium">{location.name}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {formatTimestamp(report.submitted_at, tz)}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
              {readingsCount} reading{readingsCount === 1 ? "" : "s"} recorded
            </span>
            {report.has_exceedance && exceedanceCount > 0 ? (
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${severityClass(
                  report.max_severity
                )}`}
              >
                {exceedanceCount} exceedance{exceedanceCount === 1 ? "" : "s"}
                {report.max_severity ? ` · ${report.max_severity}` : ""}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 w-full text-base sm:flex-1">
          <Link href="/reports/air-quality">Submit another</Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-12 w-full text-base sm:flex-1"
        >
          <Link href="/reports">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
