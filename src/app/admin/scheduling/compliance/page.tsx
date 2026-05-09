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
import type { Tables } from "@/types/database"

import { ComplianceClient } from "./_components/compliance-client"

export const dynamic = "force-dynamic"

export const metadata = { title: "Compliance Rules | MFO / Rink Reports" }

export default async function CompliancePage() {
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
              Create a facility before configuring compliance rules.
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
  const { data: rulesRaw } = await supabase
    .from("schedule_compliance_rules")
    .select(
      "id, facility_id, rule_type, name, description, params, is_active, sort_order, created_at, updated_at"
    )
    .eq("facility_id", facilityId)
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("rule_type", { ascending: true })

  const rules = (rulesRaw ?? []) as Tables<"schedule_compliance_rules">[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <ComplianceClient rules={rules} />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Compliance rules
      </h1>
      <p className="text-muted-foreground text-sm">
        Define facility-level rules that drive scheduling warnings.
      </p>
    </div>
  )
}
