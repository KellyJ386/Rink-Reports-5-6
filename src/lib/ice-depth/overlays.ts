// Server-side read helpers for the Ice Depth rink-diagram overlays (door
// markers + center-ice logo watermark). Facility configuration, not report
// data: every ice-depth report renders the SAME overlays, read-only,
// independent of report/lock state.
//
// RLS already scopes every query to the caller's facility (any enabled
// ice_depth grant may read; see migration 199); the explicit facility_id
// filters are defense in depth, matching the module's other loaders.

import "server-only"

import type { createClient } from "@/lib/supabase/server"
import {
  DOOR_MARKER_DEFAULT_COLOR,
  type RinkOverlayMarker,
  type RinkOverlays,
} from "./overlay-shared"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export const RINK_LOGO_BUCKET = "rink-logos"

/** Signed-URL lifetime for logo reads (report pages + PDF render). */
const LOGO_URL_TTL_SECONDS = 60 * 60

/**
 * Load both overlays for a facility, ready to render: active-type markers
 * (sorted by type sort_order, then creation) with resolved colors, and the
 * logo watermark (with a signed URL) when configured + visible.
 */
export async function getRinkOverlays(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<RinkOverlays> {
  const [typesRes, markersRes, configRes] = await Promise.all([
    supabase
      .from("facility_door_types")
      .select("id, name, color, sort_order, is_active")
      .eq("facility_id", facilityId),
    supabase
      .from("facility_door_markers")
      .select("id, door_type_id, label, position_x, position_y, created_at")
      .eq("facility_id", facilityId),
    supabase
      .from("facility_rink_diagram_config")
      .select(
        "logo_storage_path, logo_position_x, logo_position_y, logo_scale, logo_rotation, logo_opacity, logo_visible",
      )
      .eq("facility_id", facilityId)
      .maybeSingle(),
  ])

  const typeById = new Map(
    (typesRes.data ?? []).map((t) => [t.id, t] as const),
  )

  const markers: RinkOverlayMarker[] = (markersRes.data ?? [])
    .flatMap((m) => {
      const type = typeById.get(m.door_type_id)
      // Markers whose type was deactivated drop off the diagram — the type
      // lookup is the admin's on/off switch for a whole class of doors.
      if (!type || !type.is_active) return []
      return [
        {
          marker: {
            id: m.id,
            label: m.label,
            position_x: m.position_x,
            position_y: m.position_y,
            type_name: type.name,
            color: type.color ?? DOOR_MARKER_DEFAULT_COLOR,
          },
          sort: type.sort_order,
          created: m.created_at,
        },
      ]
    })
    .sort((a, b) => a.sort - b.sort || a.created.localeCompare(b.created))
    .map((entry) => entry.marker)

  const config = configRes.data
  let logo: RinkOverlays["logo"] = null
  if (config?.logo_visible && config.logo_storage_path) {
    const { data: signed } = await supabase.storage
      .from(RINK_LOGO_BUCKET)
      .createSignedUrl(config.logo_storage_path, LOGO_URL_TTL_SECONDS)
    if (signed?.signedUrl) {
      logo = {
        url: signed.signedUrl,
        position_x: config.logo_position_x,
        position_y: config.logo_position_y,
        scale: config.logo_scale,
        rotation: config.logo_rotation,
        opacity: config.logo_opacity,
      }
    }
  }

  return { markers, logo }
}

/**
 * Signed URL for the CONFIGURED logo regardless of visibility — the admin
 * editor still previews a hidden logo (grayed out) so toggling visibility
 * back on is a one-click round trip.
 */
export async function getRinkLogoSignedUrl(
  supabase: SupabaseClient,
  storagePath: string | null,
): Promise<string | null> {
  if (!storagePath) return null
  const { data } = await supabase.storage
    .from(RINK_LOGO_BUCKET)
    .createSignedUrl(storagePath, LOGO_URL_TTL_SECONDS)
  return data?.signedUrl ?? null
}
