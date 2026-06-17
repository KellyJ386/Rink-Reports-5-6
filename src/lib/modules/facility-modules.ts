import "server-only"

import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

// Pure key/label constants live in ./module-keys so client components can use
// them without importing this server-only module. Re-exported here for callers
// that already pull from facility-modules.
export {
  MODULE_LABELS,
  TOGGLEABLE_MODULE_KEYS,
  type ToggleableModuleKey,
} from "./module-keys"

/**
 * Enabled module keys for a facility (the per-facility nav feature toggle from
 * `facility_modules`). Returns `null` meaning "show everything" when there is
 * no facility or no config rows yet — fail-open so a missing/empty config can
 * never hide the entire app. Access is still independently enforced at the
 * page/RLS layer; this only drives nav visibility. Cached per server render.
 */
export const getEnabledModuleKeys = cache(
  async (facilityId: string | null | undefined): Promise<string[] | null> => {
    if (!facilityId) return null
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("facility_modules")
      .select("module_key, enabled")
      .eq("facility_id", facilityId)
    if (error || !data || data.length === 0) return null
    return data.filter((row) => row.enabled).map((row) => row.module_key)
  },
)
