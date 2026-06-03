import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { DepartmentsTab } from "./_components/departments-tab"
import type { DepartmentRow } from "./types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Departments | MFO / Rink Reports" }

function Header() {
  return (
    <PageHeader
      title="Departments"
      description="Define the departments for this facility. They power the Employee Schedule department filter, shift assignment, and communication routing."
    />
  )
}

export default async function DepartmentsAdminPage() {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before defining departments.
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
  const { data: deptsRaw } = await supabase
    .from("departments")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  const departments = (deptsRaw ?? []) as DepartmentRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <DepartmentsTab departments={departments} />
    </div>
  )
}
