// Pure parsing for Bluetooth caliper readings. Deliberately free of any
// browser / Web-Bluetooth APIs so it can be unit-tested in the plain-node
// vitest env (see caliper.test.ts). The connection hook (use-caliper.ts)
// decodes the raw GATT notification bytes to text and hands that text here.

/**
 * Extract a numeric depth reading from a caliper's text payload.
 *
 * BLE-serial calipers stream their reading as ASCII in a variety of shapes —
 * "+001.27\r\n", "12.34mm", "0,50", "-0.05" — so we normalize a comma decimal
 * separator and pull the first signed decimal token. Returns null when nothing
 * parseable is present (eg a keepalive / status frame), which the caller
 * ignores rather than writing a bogus 0 into a point.
 */
export function parseCaliperReading(text: string): number | null {
  if (!text) return null
  // Normalize EU-locale comma decimal separators ("0,50" → "0.50") before the
  // token match so they don't get split into two integers.
  const normalized = text.replace(/(\d),(\d)/g, "$1.$2")
  const match = normalized.match(/[-+]?\d*\.?\d+/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) ? n : null
}
