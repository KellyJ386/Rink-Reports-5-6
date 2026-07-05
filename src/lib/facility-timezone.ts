import "server-only"

import type { createClient } from "@/lib/supabase/server"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * The facility's IANA timezone (facilities.timezone), or null when unset.
 * Used to convert reporter-entered wall-clock times (datetime-local inputs)
 * into real UTC instants via `wallTimeToUtc` — and back via `utcToWallTime`
 * — so stored timestamps mean the same instant everywhere.
 */
export async function getFacilityTimezone(
  supabase: ServerSupabase,
  facilityId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  return data?.timezone ?? null
}
