import "server-only"

// Outside-air-temperature lookup for report prefill: facility zip →
// coordinates (Zippopotam, free/no key) → current temp °F (Open-Meteo,
// free/no key). Strictly best-effort: short timeouts and a null return on any
// failure, so a weather hiccup can never slow down or break a report form.

import { parseCurrentTempF, parseZipCoords, type ZipCoords } from "./parse"

const FETCH_TIMEOUT_MS = 3500
// Zip coordinates never change; temps go stale quickly. Both caches are
// per-server-instance best effort (serverless instances each warm their own).
const TEMP_TTL_MS = 10 * 60 * 1000

const coordsCache = new Map<string, ZipCoords | null>()
const tempCache = new Map<string, { tempF: number; at: number }>()

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Weather is time-sensitive; don't let the framework cache the response.
      cache: "no-store",
    })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

async function coordsForZip(zip: string): Promise<ZipCoords | null> {
  if (coordsCache.has(zip)) return coordsCache.get(zip) ?? null
  const json = await fetchJson(
    `https://api.zippopotam.us/us/${encodeURIComponent(zip)}`,
  )
  const coords = parseZipCoords(json)
  // Cache successes AND lookups for unknown zips; never cache transient
  // failures (json === null) so a network blip can retry next load.
  if (json !== null) coordsCache.set(zip, coords)
  return coords
}

/**
 * Current outdoor temperature (°F, whole degrees) for a US zip code, or null
 * when the zip is unknown / either service is unreachable. Callers treat null
 * as "leave the field blank for manual entry".
 */
export async function getOutsideAirTempF(
  zip: string | null | undefined,
): Promise<number | null> {
  const cleaned = (zip ?? "").trim().slice(0, 5)
  if (!/^\d{5}$/.test(cleaned)) return null

  const cached = tempCache.get(cleaned)
  if (cached && Date.now() - cached.at < TEMP_TTL_MS) return cached.tempF

  const coords = await coordsForZip(cleaned)
  if (!coords) return null

  const json = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m&temperature_unit=fahrenheit`,
  )
  const temp = parseCurrentTempF(json)
  if (temp === null) return null

  const tempF = Math.round(temp)
  tempCache.set(cleaned, { tempF, at: Date.now() })
  return tempF
}
