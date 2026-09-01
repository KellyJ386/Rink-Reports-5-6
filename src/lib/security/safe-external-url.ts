// SSRF guard for admin-supplied URLs that the SERVER later fetches
// (currently export_settings.logo_url, embedded into branded PDF exports).
//
// A facility admin types a URL; the server fetches it with its own network
// position, so a value like http://169.254.169.254/… or http://10.0.0.5:6379/
// turns that fetch into a blind internal-port probe / metadata-endpoint reach.
// This module rejects the concrete vectors: non-http(s) schemes, and hosts that
// are literal IPs in private / loopback / link-local / reserved ranges (plus
// `localhost`). It is deliberately pure so vitest can exercise every branch.
//
// RESIDUAL: a *public* hostname that resolves to a private IP (DNS rebinding)
// is not closed here — that needs a resolve-then-pin check at the socket layer,
// out of scope for this string-level guard. The value is still gated behind a
// super-admin/facility-admin write and a 3s/2MB image-only fetch.

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const octets = m.slice(1, 5).map((s) => Number(s))
  if (octets.some((n) => n < 0 || n > 255)) return null
  return octets
}

function isPrivateIpv4(host: string): boolean {
  const o = ipv4Octets(host)
  if (!o) return false
  const [a, b] = o
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // loopback 127.0.0.0/8
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a === 169 && b === 254) return true // link-local 169.254.0.0/16 (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && o[2] === 0) return true // 192.0.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmark
  if (a >= 224) return true // multicast 224/4 + reserved 240/4
  return false
}

function isPrivateIpv6(host: string): boolean {
  // URL hostnames may keep IPv6 in brackets; normalize and lowercase.
  const h = host.replace(/^\[|\]$/g, "").toLowerCase()
  if (h === "::1" || h === "::") return true // loopback / unspecified
  if (h.startsWith("fe80")) return true // link-local fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d). The WHATWG URL parser re-serializes the
  // embedded IPv4 as two hex groups (::ffff:a9fe:a9fe), so decode both forms.
  const mapped = /^::ffff:(.+)$/.exec(h)
  if (mapped) {
    const rest = mapped[1]
    if (rest.includes(".")) return isPrivateIpv4(rest)
    const groups = rest.split(":")
    if (groups.length === 2) {
      const hi = parseInt(groups[0], 16)
      const lo = parseInt(groups[1], 16)
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
        return isPrivateIpv4(ipv4)
      }
    }
  }
  return false
}

/**
 * True when `raw` is a syntactically valid http(s) URL whose host is not an
 * obviously-internal target. Returns false for anything unparseable, any scheme
 * other than http/https, and any literal private/loopback/link-local IP host or
 * `localhost`.
 */
export function isSafeExternalHttpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false

  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return false
  if (isPrivateIpv4(host)) return false
  if (host.includes(":") || host.startsWith("[")) {
    if (isPrivateIpv6(host)) return false
  }
  return true
}
