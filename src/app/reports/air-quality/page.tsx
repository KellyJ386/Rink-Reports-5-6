import Link from "next/link"

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

  if (!(await currentUserCan(supabase, "air_quality", "submit"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to submit air quality reports."
      />
    )
  }

  const { data: locationsRaw } = await supabase
    .from("facility_spaces")
    .select("id, name, slug, sort_order, is_active")
    .eq("facility_id", employeeRow.facility_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  const locations = locationsRaw ?? []

  if (locations.length === 0) {
    return (
      <NotAvailable
        title="Not configured yet"
        description="Air quality reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="air"
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Air Quality" },
            ]}
          />
        }
        title="Air Quality"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {locations.map((loc) => (
          <Link
            key={loc.id}
            href={`/reports/air-quality/${encodeURIComponent(loc.slug)}`}
            className="group rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="h-full min-h-28 transition-colors group-hover:bg-accent/30">
              <CardHeader>
                <CardTitle className="text-lg">{loc.name}</CardTitle>
                <CardDescription>
                  Submit readings for this location.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
