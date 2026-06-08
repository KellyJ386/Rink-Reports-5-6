import "server-only"

import { createClient } from "@/lib/supabase/server"
import { getCurrentTempForFacility } from "@/lib/weather/current-temp"

export type HeaderContext = {
  facilityName: string | null
  tempF: number | null
  tempLocation: string | null
}

const EMPTY: HeaderContext = {
  facilityName: null,
  tempF: null,
  tempLocation: null,
}

/**
 * Loads the facility name and current outdoor temperature shown in the global
 * header. Temperature is the facility's local/outdoor weather (Open-Meteo,
 * geocoded from city/state); the app has no building/ice temperature feed.
 */
export async function getHeaderContext(
  facilityId: string | null | undefined,
): Promise<HeaderContext> {
  if (!facilityId) return EMPTY
  const supabase = await createClient()
  const { data: facility } = await supabase
    .from("facilities")
    .select("name, city, state, zip_code")
    .eq("id", facilityId)
    .maybeSingle()
  if (!facility) return EMPTY
  const temp = await getCurrentTempForFacility(facility)
  return {
    facilityName: facility.name ?? null,
    tempF: temp?.tempF ?? null,
    tempLocation: temp?.location ?? null,
  }
}
