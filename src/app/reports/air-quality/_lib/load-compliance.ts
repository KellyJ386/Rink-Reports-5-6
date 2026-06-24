// Server-only loader that assembles the runtime compliance context for a
// facility: its selected global profile (migration 146) joined with the
// per-facility config (migration 147), resolved through the pure engine into
// active metrics + effective (override-tightened) tiers. Shared by the admin
// compliance panel, the staff reading form, and the submit pipeline so all
// three evaluate against exactly the same rules.

import "server-only"

import type { Json } from "@/types/database"
import type { createClient } from "@/lib/supabase/server"

import {
  effectiveTiers,
  parseActiveMetrics,
  parseEscalationConfig,
  parseMethod,
  parseMetrics,
  parseSamplingRules,
  parseTiers,
  type MeasurementMethod,
  type MetricDef,
  type ProfileTiers,
  type SamplingRules,
} from "./compliance"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type ComplianceProfileSummary = {
  id: string
  jurisdiction: string
  display_name: string
  method: MeasurementMethod
  is_binding: boolean
  guidance_note: string | null
}

export type ComplianceContext = {
  profile: ComplianceProfileSummary | null
  /** Metrics actually collected (profile metrics ∩ facility active_metrics). */
  metrics: MetricDef[]
  method: MeasurementMethod
  /** Per active metric, tiers after applying stricter-only facility overrides. */
  effectiveTiers: ProfileTiers
  /** Profile tiers BEFORE overrides (the regulatory floor), for admin display. */
  profileTiers: ProfileTiers
  samplingRules: SamplingRules
  escalationRules: Json
  /** Per-tier escalation steps/contacts text from the facility config. */
  escalation: Record<string, string>
  activeMetricKeys: string[]
  overrides: ProfileTiers
}

const EMPTY: ComplianceContext = {
  profile: null,
  metrics: [],
  method: "single",
  effectiveTiers: {},
  profileTiers: {},
  samplingRules: parseSamplingRules(null),
  escalationRules: {},
  escalation: {},
  activeMetricKeys: [],
  overrides: {},
}

export async function loadComplianceContext(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<ComplianceContext> {
  const { data: config } = await supabase
    .from("facility_air_quality_config")
    .select(
      "compliance_profile_id, active_metrics, threshold_overrides, frequency_config, escalation_config",
    )
    .eq("facility_id", facilityId)
    .maybeSingle()

  if (!config?.compliance_profile_id) return EMPTY

  const { data: profile } = await supabase
    .from("air_quality_compliance_profiles")
    .select(
      "id, jurisdiction, display_name, method, is_binding, metrics, tiers, sampling_rules, escalation_rules, guidance_note",
    )
    .eq("id", config.compliance_profile_id)
    .maybeSingle()

  if (!profile) return EMPTY

  const allMetrics = parseMetrics(profile.metrics)
  const profileTiers = parseTiers(profile.tiers)
  const overrides = parseTiers(config.threshold_overrides)

  // active_metrics defaults to every profile metric when unset/empty.
  const activeFromConfig = parseActiveMetrics(config.active_metrics)
  const activeMetricKeys =
    activeFromConfig.length > 0
      ? activeFromConfig
      : allMetrics.map((m) => m.key)

  const metrics = allMetrics.filter((m) => activeMetricKeys.includes(m.key))

  // Effective tiers only for active metrics.
  const activeProfileTiers: ProfileTiers = {}
  for (const key of activeMetricKeys) {
    if (profileTiers[key]) activeProfileTiers[key] = profileTiers[key]
  }
  const eff = effectiveTiers(activeProfileTiers, overrides)

  return {
    profile: {
      id: profile.id,
      jurisdiction: profile.jurisdiction,
      display_name: profile.display_name,
      method: parseMethod(profile.method),
      is_binding: profile.is_binding,
      guidance_note: profile.guidance_note,
    },
    metrics,
    method: parseMethod(profile.method),
    effectiveTiers: eff,
    profileTiers,
    samplingRules: parseSamplingRules(profile.sampling_rules),
    escalationRules: config.escalation_config ?? profile.escalation_rules ?? {},
    escalation: parseEscalationConfig(config.escalation_config),
    activeMetricKeys,
    overrides,
  }
}
