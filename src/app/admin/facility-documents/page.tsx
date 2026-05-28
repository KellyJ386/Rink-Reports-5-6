import Link from "next/link"
import { redirect } from "next/navigation"

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

import { FacilityDocumentsClient } from "./_components/facility-documents-client"
import type { FacilityDocumentRow } from "./types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Facility Paperwork | MFO / Rink Reports" }

type SearchParams = Promise<{ facility?: string }>

type FacilityOption = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Facility Paperwork
      </h1>
      <p className="text-muted-foreground text-sm">
        Upload and manage the documents, policies, and manuals your staff can
        browse and download. Bulk-upload multiple files at once.
      </p>
    </div>
  )
}

export default async function FacilityDocumentsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const profile = current.profile
  const params = await searchParams

  const facilityId = profile?.is_super_admin
    ? (params?.facility ?? null)
    : (profile?.facility_id ?? null)

  // Super admin with no facility chosen: offer a picker (mirrors employees).
  if (!facilityId && profile?.is_super_admin) {
    const supabase = await createClient()
    const { data: facilitiesRaw } = await supabase
      .from("facilities")
      .select("id, name, slug, is_active")
      .order("created_at", { ascending: true })
    const facilities = (facilitiesRaw ?? []) as FacilityOption[]

    if (facilities.length === 1) {
      redirect(`/admin/facility-documents?facility=${facilities[0].id}`)
    }

    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>
              {facilities.length === 0 ? "No facilities yet" : "Choose a facility"}
            </CardTitle>
            <CardDescription>
              {facilities.length === 0
                ? "Create a facility before uploading documents."
                : "Pick a facility to manage its paperwork."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {facilities.length === 0 ? (
              <Button asChild>
                <Link href="/admin/facility">Go to Facility Settings</Link>
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                {facilities.map((f) => (
                  <Button
                    key={f.id}
                    asChild
                    variant="outline"
                    className="justify-between"
                  >
                    <Link href={`/admin/facility-documents?facility=${f.id}`}>
                      <span>
                        {f.name}
                        {!f.is_active && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            (Inactive)
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {f.slug}
                      </span>
                    </Link>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Your account isn&apos;t linked to a facility yet. Ask a super
              admin to assign you.
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
  const { data: docsRaw } = await supabase
    .from("facility_documents")
    .select("*")
    .eq("facility_id", facilityId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })

  const documents = (docsRaw ?? []) as unknown as FacilityDocumentRow[]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <FacilityDocumentsClient facilityId={facilityId} documents={documents} />
    </div>
  )
}
