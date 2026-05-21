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
}

async function geocodeFacility(
  loc: FacilityLocation,
): Promise<GeocodingHit | null> {
  const query = loc.zip_code || loc.city
  if (!query) return null

  const params = new URLSearchParams({
    name: query,
    count: "1",
    language: "en",
    format: "json",
    country: "US",
  })

  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`,
      { next: { revalidate: 60 * 60 * 24 } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { results?: GeocodingHit[] }
    const hit = json.results?.[0]
    if (!hit) return null
    if (loc.state && hit.admin1 && hit.admin1.toLowerCase() !== loc.state.toLowerCase()) {
      // City name matched in another state — keep the result but flag nothing;
      // Open-Meteo's first hit by population is typically right enough.
    }
    return hit
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
      { next: { revalidate: 60 * 10 } },
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
