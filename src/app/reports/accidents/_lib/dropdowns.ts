import "server-only"

import { unstable_cache } from "next/cache"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Cached read of accident_dropdowns for a facility. Hit on every accident
 * report submission and edit page load — the per-facility list is small,
 * admin-managed, and rarely changes, so a 1-hour cache + tag-based
 * invalidation is a strong fit.
 *
 * Uses the service-role client so the cache value is genuinely per-facility
 * rather than per-(user, facility) — RLS would have made the cache key
 * dependent on the session cookie, which next/cache can't safely close
 * over. The caller is expected to have already proven they belong to the
 * facility (via requireUser() + employees lookup) before passing facilityId
 * in here; otherwise this becomes a tenant-isolation bypass.
 *
 * Per-facility cache invalidation: every admin action that mutates
 * accident_dropdowns should call
 * `revalidateTag(accidentDropdownsTag(facilityId))` so other facilities
 * stay cached.
 */
export type AccidentDropdownRow = {
  id: string
  category: string
  key: string
  display_name: string
  color: string | null
  sort_order: number
  metadata: unknown
}

export function accidentDropdownsTag(facilityId: string): string {
  return `accident-dropdowns:${facilityId}`
}

export async function getAccidentDropdowns(
  facilityId: string,
): Promise<AccidentDropdownRow[]> {
  // unstable_cache is constructed inside this wrapper so the cache key
  // and the tags array can both close over facilityId. Without the
  // wrapper, the tags array would have to be static and invalidations
  // would either be facility-wide (coarse) or impossible.
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from("accident_dropdowns")
        .select("id, category, key, display_name, color, sort_order, metadata")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("display_name", { ascending: true })
      if (error) {
        throw new Error(`accident_dropdowns read failed: ${error.message}`)
      }
      return (data ?? []) as AccidentDropdownRow[]
    },
    ["accident-dropdowns", facilityId],
    {
      revalidate: 3600,
      tags: [accidentDropdownsTag(facilityId)],
    },
  )()
}
