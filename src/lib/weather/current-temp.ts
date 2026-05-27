import "server-only"

export type CurrentTemp = {
  tempF: number
  tempC: number
  fetchedAt: string
  location: string | null
}

type FacilityLocation = {
  city: string | null
  state: string | null
  zip_code: string | null
}

type GeocodingHit = {
  latitude: number
  longitude: number
  name?: string
  admin1?: string
  country_code?: string
}

async function geocodeFacility(
  loc: FacilityLocation,
): Promise<GeocodingHit | null> {
  // Open-Meteo's geocoder searches place *names*, not postal codes, and has no
  // country filter param — so prefer the city and disambiguate by state below.
  const query = loc.city || loc.zip_code
  if (!query) return null

  const params = new URLSearchParams({
    name: query,
    count: "5",
    language: "en",
    format: "json",
  })

  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`,
      { next: { revalidate: 60 * 60 * 24 }, signal: AbortSignal.timeout(3000) },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { results?: GeocodingHit[] }
    const results = (json.results ?? []).filter(
      (r) => !r.country_code || r.country_code.toUpperCase() === "US",
    )
    if (results.length === 0) return null
    // Prefer a result whose state (admin1) matches the facility's state so an
    // ambiguous city name (e.g. "Springfield") resolves to the right place.
    const stateMatch = loc.state
      ? results.find(
          (r) => r.admin1?.toLowerCase() === loc.state!.toLowerCase(),
        )
      : undefined
    return stateMatch ?? results[0]
  } catch {
    return null
  }
}

export async function getCurrentTempForFacility(
  loc: FacilityLocation,
): Promise<CurrentTemp | null> {
  const hit = await geocodeFacility(loc)
  if (!hit) return null

  const params = new URLSearchParams({
    latitude: hit.latitude.toFixed(3),
    longitude: hit.longitude.toFixed(3),
    current: "temperature_2m",
    temperature_unit: "fahrenheit",
    timezone: "auto",
  })

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      { next: { revalidate: 60 * 10 }, signal: AbortSignal.timeout(3000) },
    )
    if (!res.ok) return null
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; time?: string }
    }
    const tempF = json.current?.temperature_2m
    if (typeof tempF !== "number") return null
    const tempC = ((tempF - 32) * 5) / 9
    return {
      tempF,
      tempC,
      fetchedAt: json.current?.time ?? new Date().toISOString(),
      location: hit.name
        ? hit.admin1
          ? `${hit.name}, ${hit.admin1}`
          : hit.name
        : null,
    }
  } catch {
    return null
  }
}
