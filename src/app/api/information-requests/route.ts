import { NextRequest, NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

type RequestBody = {
  name?: string
  email?: string
  company?: string
  addressLine1?: string
  addressLine2?: string
  addressCity?: string
  addressRegion?: string
  addressPostal?: string
  addressCountry?: string
  note?: string
}

const MAX_LEN = 2000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, MAX_LEN)
}

export async function POST(request: NextRequest) {
  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const name = clean(body.name)
  const email = clean(body.email)
  const company = clean(body.company)
  const addressCountry = clean(body.addressCountry)

  if (!name || !email || !company || !addressCountry) {
    return NextResponse.json(
      { error: "Name, email, company, and country are required." },
      { status: 400 }
    )
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  // The `information_requests` table is not yet in the generated DB types,
  // mirroring the pattern used in src/app/api/offline-sync/route.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("information_requests")
    .insert({
      name,
      email,
      company,
      address_line1: clean(body.addressLine1),
      address_line2: clean(body.addressLine2),
      address_city: clean(body.addressCity),
      address_region: clean(body.addressRegion),
      address_postal: clean(body.addressPostal),
      address_country: addressCountry,
      note: clean(body.note),
    })

  if (error) {
    return NextResponse.json(
      { error: "Could not save your request. Please try again." },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
