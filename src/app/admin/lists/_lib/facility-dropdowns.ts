import "server-only"

import { unstable_cache } from "next/cache"

import { createAdminClient } from "@/lib/supabase/admin"

import type { DropdownDomain } from "../types"

/**
 * Cached read of facility_dropdown_options for a (facility, domain). Mirrors
 * the accident_dropdowns cache (src/app/reports/accidents/_lib/dropdowns.ts):
 * read on every page that renders one of these picker lists (e.g. the Facility
 * settings timezone select), per-facility, admin-managed, rarely changing — so
 * a 1-hour cache + tag-based invalidation is a strong fit.
 *
 * Uses the service-role client so the cache value is genuinely per-(facility,
 * domain) rather than per-session — RLS would make the cache key depend on the
 * auth cookie, which next/cache can't safely close over. Callers must already
 * have proven they belong to the facility before passing facilityId in.
 *
 * Every admin write to facility_dropdown_options MUST call
 * `updateTag(facilityDropdownsTag(facilityId, domain))` so other facilities /
 * domains stay cached.
 */
export type FacilityDropdownOption = {
  id: string
  key: string
  display_name: string
  color: string | null
  sort_order: number
  metadata: unknown
}

export function facilityDropdownsTag(
  facilityId: string,
  domain: DropdownDomain,
): string {
  return `facility-dropdowns:${domain}:${facilityId}`
}

export async function getFacilityDropdownOptions(
  facilityId: string,
  domain: DropdownDomain,
): Promise<FacilityDropdownOption[]> {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from("facility_dropdown_options")
        .select("id, key, display_name, color, sort_order, metadata")
        .eq("facility_id", facilityId)
        .eq("domain", domain)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true })
      if (error) {
        throw new Error(
          `facility_dropdown_options read failed: ${error.message}`,
        )
      }
      return (data ?? []) as FacilityDropdownOption[]
    },
    ["facility-dropdowns", domain, facilityId],
    {
      revalidate: 3600,
      tags: [facilityDropdownsTag(facilityId, domain)],
    },
  )()
}
