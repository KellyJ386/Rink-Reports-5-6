import "server-only"

const FETCH_TIMEOUT_MS = 3_000
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB

/**
 * Fetches export_settings.logo_url and returns it as a data URI for
 * @react-pdf/renderer's <Image>, which needs the bytes in hand rather than a
 * bare remote URL — a slow, unreachable, or oversized logo host must never
 * stall or crash PDF generation. Any failure (network, timeout, non-image
 * content-type, oversized body) returns null; the caller renders the header
 * without a logo rather than failing the whole export over a branding asset.
 */
export async function fetchLogoDataUri(logoUrl: string | null | undefined): Promise<string | null> {
  if (!logoUrl) return null

  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null

    const contentType = res.headers.get("content-type") ?? ""
    if (!contentType.startsWith("image/")) return null

    const contentLength = res.headers.get("content-length")
    if (contentLength && Number(contentLength) > MAX_LOGO_BYTES) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength > MAX_LOGO_BYTES) return null

    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch {
    return null
  }
}
