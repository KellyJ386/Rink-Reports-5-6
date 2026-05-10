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
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Ice Depth
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

export default async function IceDepthHomePage() {
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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "ice_depth")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to submit ice depth reports."
      />
    )
  }

  const { data: layoutsRaw } = await supabase
    .from("ice_depth_layouts")
    .select("id, name, slug, description, sort_order, is_active")
    .eq("facility_id", employeeRow.facility_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  const layouts = layoutsRaw ?? []

  if (layouts.length === 0) {
    return (
      <NotAvailable
        title="Not configured yet"
        description="Ice depth reporting isn't configured yet. Talk to your administrator."
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Ice Depth
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Ice depth
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a layout to record measurements.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {layouts.map((layout) => (
          <Link
            key={layout.id}
            href={`/reports/ice-depth/${encodeURIComponent(layout.slug)}`}
            className="group rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="h-full min-h-28 transition-colors group-hover:bg-accent/30">
              <CardHeader>
                <CardTitle className="text-lg">{layout.name}</CardTitle>
                <CardDescription>
                  {layout.description ??
                    "Record depth measurements for this layout."}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
