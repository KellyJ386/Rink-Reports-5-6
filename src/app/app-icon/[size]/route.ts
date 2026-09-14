import { ImageResponse } from "next/og"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createElement } from "react"

const supportedSizes = new Set([180, 192, 512])

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: requestedSize } = await params
  const size = Number(requestedSize)

  if (!supportedSizes.has(size)) {
    return new Response("Unsupported icon size", { status: 404 })
  }

  const svg = await readFile(join(process.cwd(), "public", "app-icon.svg"), "utf8")

  return new ImageResponse(
    createElement("img", {
      alt: "",
      src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      width: size,
      height: size,
    }),
    {
      width: size,
      height: size,
    }
  )
}
