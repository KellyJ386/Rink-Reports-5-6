import type { Tables } from "@/types/database"

export type IceDepthLayout = Tables<"ice_depth_layouts">
export type IceDepthPoint = Tables<"ice_depth_points">
export type IceDepthSettings = Tables<"ice_depth_settings">
export type IceDepthSession = Tables<"ice_depth_sessions">
export type IceDepthMeasurement = Tables<"ice_depth_measurements">

export type Severity = "ok" | "low" | "high"

export type LayoutForForm = {
  id: string
  name: string
  slug: string
  diagram_aspect_ratio: number
  logo_url: string | null
}

export type PointForForm = {
  id: string
  point_number: number
  label: string | null
  x_position: number
  y_position: number
  sort_order: number
}

export type SettingsForForm = {
  measurement_unit: string
  low_threshold: number
  high_threshold: number
}

/**
 * Hidden `measurements_json` payload shape.
 * Server recomputes severity and snapshots point data.
 */
export type SubmittedMeasurement = {
  point_id: string
  depth_value: number
}
