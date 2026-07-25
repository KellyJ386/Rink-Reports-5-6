# Air Quality — threshold enforcement verification (2026-07)

**Question investigated:** the review asked whether air-quality limits are
actually *enforced* server-side, or only stored and displayed — "a smoke
detector with the green light on that has never made a sound."

**Answer: enforcement is real, server-side, and shared by the offline path.**
No code change required. This note records the trace so the question doesn't
need re-answering.

## What the review remembered (stale)

An older model stored `warn_min/warn_max/alert_min/alert_max` on
`air_quality_thresholds` and rendered `RangeBadgePill`s client-side. That
table (and the badge component) no longer exist — migration
`00000000000153_air_quality_retire_thresholds.sql` dropped them when the
jurisdiction compliance engine landed (migrations 146/147/152).

## What actually enforces limits today

The engine is split between a pure module and a server-only submit path:

- **Pure engine** — `src/app/reports/air-quality/_lib/compliance.ts`
  - Tiers `corrective → notification → evacuation`, stored on global
    `air_quality_compliance_profiles` with per-facility
    `facility_air_quality_config` overrides.
  - `effectiveMetricTiers()` merges profile + overrides and only allows
    overrides that are *stricter* (`validateOverrides()` rejects loosening).
  - `evaluateMetric()` returns the highest matched tier; supports plain `max`
    ceilings and consecutive-readings rules (MA-style `{count, over}`).
  - Unit-tested: `compliance.test.ts`, `sustained.test.ts`.

- **Server-side evaluation** — `src/app/reports/air-quality/_lib/submit.ts`
  (`import "server-only"`):
  1. Loads the compliance context and evaluates **every** reading
     (`evaluateMetric` per reading type).
  2. **Hard-blocks** submission of an over-threshold reading without a
     corrective-action note.
  3. Stamps each reading row: `is_exceedance`, `severity_at_submit`,
     `compliance_max_at_submit`; rolls `has_exceedance` / `max_severity`
     up to `air_quality_reports`.
  4. Inserts an acknowledgement-required `communication_alerts` row when
     `air_quality_settings.alerts_enabled`.
  5. `evaluateAndAlertSustained()` checks the recent series at the location
     against `air_quality_compliance_rules` sustained criteria and raises a
     `critical` "SUSTAINED exceedance — evacuation criteria" alert on a hit.

- **Offline parity:** `/api/offline-sync` replays queued submissions through
  the same `persistAirQuality` path, so offline submissions are evaluated
  identically to online ones.

- **Client display** (`TierHint`, `AlertLevelBadge` in
  `_components/submission-form.tsx`) is a mirror of the same pure engine —
  a preview, not the authority.

## Comparison: refrigeration

Refrigeration follows the same shape with an older threshold model
(`refrigeration_thresholds` min/max → `is_out_of_range` + `severity`
stamping, bundled `communication_alerts`, corrective-note requirement for
critical readings in `_lib/compute.ts` / `_lib/submit.ts`). Air quality is
the more advanced of the two.
