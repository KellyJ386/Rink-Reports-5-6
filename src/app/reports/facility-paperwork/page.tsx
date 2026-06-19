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

import { DocumentsBrowser, type BrowserDocument } from "./_components/documents-browser"

export const dynamic = "force-dynamic"
export const metadata = { title: "Facility Paperwork | Rink Reports" }

type DocumentRow = {
  id: string
  title: string
  description: string | null
  category: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

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
      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>{" "}
        / Facility Paperwork
      </p>
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

export default async function FacilityPaperworkPage() {
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

  const { data: docsRaw } = await supabase
    .from("facility_documents")
    .select(
      "id, title, description, category, storage_path, file_name, mime_type, size_bytes, created_at",
    )
    .eq("facility_id", employeeRow.facility_id)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true })

  const rows = (docsRaw ?? []) as unknown as DocumentRow[]

  // Sign a short-lived download URL per document. RLS on the storage bucket
  // scopes signing to objects in the caller's facility folder.
  const documents: BrowserDocument[] = []
  for (const row of rows) {
    const { data: signed } = await supabase.storage
      .from("facility-documents")
      .createSignedUrl(row.storage_path, 60 * 60, { download: row.file_name })
    documents.push({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      downloadUrl: signed?.signedUrl ?? null,
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div
        className="flex flex-col gap-1 overflow-hidden rounded-2xl border-l-4 border-l-module-paperwork px-4 py-4"
        style={{
          ["--module-accent" as string]: "var(--module-paperwork)",
          backgroundImage:
            "linear-gradient(120deg, color-mix(in oklab, var(--module-accent) 14%, transparent) 0%, transparent 70%)",
        }}
      >
        <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-module-paperwork">
          Facility
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Facility Paperwork
        </h1>
      </div>

      <DocumentsBrowser documents={documents} />
    </div>
  )
}
