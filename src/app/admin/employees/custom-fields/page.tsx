import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  CustomFieldsClient,
  type CustomFieldRow,
} from "./_components/custom-fields-client"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Custom employee fields | MFO / Rink Reports",
}

type SearchParams = Promise<{ facility?: string }>

export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { profile } = await requireAdmin()
  const params = await searchParams

  const facilityId = profile?.is_super_admin
    ? (params?.facility ?? null)
    : (profile?.facility_id ?? null)

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>
              {profile?.is_super_admin ? "Choose a facility" : "No facility yet"}
            </CardTitle>
            <CardDescription>
              {profile?.is_super_admin
                ? "Pick a facility to manage its custom employee fields. Pass ?facility=<id> in the URL."
                : "Your account isn't linked to a facility yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()
  // employee_custom_fields isn't in generated types yet; cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fieldsRaw } = await (supabase as any)
    .from("employee_custom_fields")
    .select("id, facility_id, key, label, field_type, is_required, sort_order, is_active")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  const fields = (fieldsRaw ?? []) as CustomFieldRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How custom fields work</CardTitle>
          <CardDescription>
            Active fields render on the{" "}
            <Link href="/admin/employees" className="underline">
              employee form
            </Link>
            . Toggle a field inactive to hide it without losing stored values.
          </CardDescription>
        </CardHeader>
      </Card>
      <CustomFieldsClient facilityId={facilityId} fields={fields} />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Custom employee fields
      </h1>
      <p className="text-muted-foreground text-sm">
        Define facility-specific employee attributes (locker number, t-shirt
        size, license expiry, …) that show up on the employee form.
      </p>
    </div>
  )
}
