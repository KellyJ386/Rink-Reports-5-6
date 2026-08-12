// Pure response parsers for the outside-air-temperature lookup (Zippopotam
// zip geocoding + Open-Meteo current weather). No fetch / server imports here
// so these are unit-testable (see parse.test.ts); the network wrapper lives in
// ./server.ts.

export type ZipCoords = { latitude: number; longitude: number }

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Zippopotam (`api.zippopotam.us/us/<zip>`) response → coordinates.
 * Shape: `{ places: [{ latitude: "43.03", longitude: "-76.13", ... }] }`
 * (lat/lon arrive as strings). Null on anything unexpected.
 */
export function parseZipCoords(json: unknown): ZipCoords | null {
  if (!json || typeof json !== "object") return null
  const places = (json as Record<string, unknown>).places
  if (!Array.isArray(places) || places.length === 0) return null
  const first = places[0]
  if (!first || typeof first !== "object") return null
  const p = first as Record<string, unknown>
  const latitude = asFiniteNumber(p.latitude)
  const longitude = asFiniteNumber(p.longitude)
  if (latitude === null || longitude === null) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

/**
 * Open-Meteo forecast response (`current=temperature_2m`,
 * `temperature_unit=fahrenheit`) → current temperature in °F.
 * Shape: `{ current: { temperature_2m: 71.4 } }`. Null on anything unexpected
 * or physically implausible.
 */
export function parseCurrentTempF(json: unknown): number | null {
  if (!json || typeof json !== "object") return null
  const current = (json as Record<string, unknown>).current
  if (!current || typeof current !== "object") return null
  const t = asFiniteNumber((current as Record<string, unknown>).temperature_2m)
  if (t === null) return null
  // Sanity bounds: reject sensor/API garbage far outside Earth-surface range.
  if (t < -100 || t > 140) return null
  return t
}
