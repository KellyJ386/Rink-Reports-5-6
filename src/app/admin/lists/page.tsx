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

import { OptionsTab } from "./_components/options-tab"
import {
  DOMAINS,
  DOMAIN_CONFIG,
  isDomain,
  type DropdownDomain,
  type FacilityDropdownOptionRow,
} from "./types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Lists | MFO / Rink Reports" }

type SearchParams = Promise<{ domain?: string }>

export default async function ListsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const params = await searchParams
  const facilityId = current.profile?.facility_id ?? null

  const domain: DropdownDomain =
    params.domain && isDomain(params.domain) ? params.domain : DOMAINS[0]
  const config = DOMAIN_CONFIG[domain]

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before managing its lists.
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
  const { data } = await supabase
    .from("facility_dropdown_options")
    .select("*")
    .eq("facility_id", facilityId)
    .order("domain", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true })

  const all = (data ?? []) as FacilityDropdownOptionRow[]

  const countsByDomain = DOMAINS.reduce(
    (acc, d) => {
      acc[d] = 0
      return acc
    },
    {} as Record<DropdownDomain, number>,
  )
  for (const row of all) {
    if (isDomain(row.domain)) {
      countsByDomain[row.domain] = (countsByDomain[row.domain] ?? 0) + 1
    }
  }

  const rows = all.filter((r) => r.domain === domain)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <OptionsTab
        config={config}
        rows={rows}
        countsByDomain={countsByDomain}
      />
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Lists"
      description="Customize the per-facility option lists used by dropdowns across the app. Changes apply only to your facility."
    />
  )
}
