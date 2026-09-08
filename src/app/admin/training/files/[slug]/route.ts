import { NextResponse } from "next/server"

import { getCurrentUser, getIsAdmin } from "@/lib/auth"
import { findTrainingDoc } from "@/lib/training-docs"

import { readTrainingFile } from "../../_lib/read-doc"

// Streams a training doc's PDF (or its raw markdown when no PDF exists).
// Route handlers don't inherit the admin layout's guard, so the admin check
// is repeated here. The file is resolved from the manifest by slug — the
// request never supplies a path.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const current = await getCurrentUser()
  if (!current) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }
  if (!(await getIsAdmin(current))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  const { slug } = await params
  const doc = findTrainingDoc(slug)
  const file = doc ? await readTrainingFile(doc) : null
  if (!file) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  // `inline` lets a PDF open in the browser tab; the filename is used when
  // the viewer saves it. Markdown fallback downloads as an attachment.
  const disposition = doc?.pdf ? "inline" : "attachment"
  return new NextResponse(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.body.byteLength),
      "Content-Disposition": `${disposition}; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
