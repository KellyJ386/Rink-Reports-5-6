# Ice Depth Module Audit — Agent-ICEDEPTH

- **Module audited:** `src/app/reports/ice-depth/` + `src/app/admin/ice-depth/`
- **Migrations audited:** 14, 35, 67, 83, 138 (+ 071 for policy upgrade)
- **Supabase project:** `bqbdgwlhbhabsibjgwmk` (SCHEMA-report cross-referenced)
- **Mode:** AUDIT-ONLY. No code/migration/schema writes.
- **Date:** 2026-06-17.

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK · ℹ️ INFO

---

## Grade: 88 / 100

**Status: PASS with minor gaps.** The Ice Depth module is the best-engineered report flow in the codebase. It achieves clean cross-cutting concerns: server-computed severity, snapshotted immutability, an offline replay path that runs the same pipeline as the online path, DB-level caps and CHECK constraints, full RLS coverage with facility scoping, and a rich analytics layer. No critical findings. No photo/file upload anywhere. Three small gaps hold it below 95.

---

## Strengths

1. **Two-layer integrity on depth values.** `parseMeasurements()` in `compute.ts` rejects non-finite and negative values; migration 138 adds a DB-level `CHECK (depth_value >= 0)` constraint as a second floor — classic defense-in-depth.
2. **Snapshotted immutability.** Each session snapshots `measurement_unit`, `low_threshold`, and `high_threshold` at submit time so historical reads are interpretable even after admin changes thresholds. Severity is persisted (not derived), preventing retroactive reclassification.
3. **Identical online/offline pipeline.** `persistIceDepth()` is shared between the online server action and the offline replay endpoint (`handleIceDepthReplay`). The offline path claims an idempotency token via `offline_sync_queue.local_id` before writing so duplicate retries are silently dropped.
4. **RLS depth and breadth.** Every ice-depth table has RLS ON with facility scoping. Session INSERT enforces `employee_id = current_employee_id()` at the DB layer. UPDATE/DELETE on sessions is super_admin-only; the module mirrors the append-only note model for admin corrections.
5. **DB-enforced caps.** Trigger functions guard `<= 8 active layouts per facility` and `<= 60 active points per layout`, with clean error messages surfaced through `dbError()` in the admin actions.
6. **Analytics layer.** `_lib/analytics.ts` provides a full per-point rollup (avg/min/max, low/high rates, dominant severity, trend-by-day) in pure, unit-tested code. The admin tab renders a heat-map overlay, per-point table sorted worst-first, and a daily activity strip chart.
7. **Zero photo/file upload.** Confirmed: no `<input type="file">`, no `FileReader`, no `storage.upload`, no camera reference anywhere under `src/app/reports/ice-depth/` or `src/app/admin/ice-depth/`. The `logo_url` field in the layout editor is `type="url"` (plain text URL), not a file input.
8. **Rink hierarchy (mig 83).** A real rink (sheet of ice) layer was introduced above the diagram, with default-rink and default-diagram partial unique indexes, auto-opening logic, and a cascading nav picker in the staff UI.
9. **Retention purge (mig 138).** Nightly `purge_old_ice_depth_sessions()` worker mirrors the pattern of other modules and is granted only to `service_role` — blocked from `authenticated` and `anon` by explicit `REVOKE`.
10. **Input validation consistent with codebase standard.** Admin actions use `nonEmpty`/`asInt`/`asNumber`/`SLUG_RE`/`HEX_RE` (the same manual helpers used across all admin modules). No Zod (W1 from SEC-report is a codebase-wide pattern gap, not an ice-depth specific gap).

---

## Gaps

### 🟡 G1 — `deleteIceDepthSession` skips `facility_id` filter for super_admins

**Location:** `src/app/admin/ice-depth/actions.ts:907-933`

`deleteIceDepthSession` conditionally omits `.eq("facility_id", facilityId)` when `current.profile?.facility_id` is null (which is the case for super_admins who have no facility). The action note says "RLS will block non-super-admin with permission denied" — and the session-level RLS UPDATE/DELETE policy IS super_admin-only, so this is safe in practice. However the action itself never validates that the session's facility matches the caller's intent: a super_admin could delete a session belonging to any facility without the action providing any additional scope. This is intentional for the super_admin cross-facility use case but is undocumented and could surprise future maintainers.

**Recommended fix:** Add a comment explicitly documenting the intended super_admin cross-facility scope, or add a `canDelete` guard in the caller (the history tab already gates the delete button on `is_super_admin === true`).

### 🟡 G2 — `ice_depth_change_log` INSERT policy references non-existent helper (historical, resolved)

**Location:** `supabase/migrations/00000000000035_ice_depth_change_log.sql:51`

Migration 035 creates the `ice_depth_change_log_insert` policy using `has_module_permission('ice_depth', 'submit')`, a function that migration 071 later drops. Migration 071 recreates the policy with `current_employee_module_permission('ice_depth') >= 'submit'`, so the live DB is correct. However, because `git reset --local` runs migrations in order, any attempt to `supabase db reset` locally will apply migration 035 (creating the policy with a valid function at that point), then migration 071 (dropping that function and recreating the policy with the new helper) — which works. The historical migration is not self-contained, but this is an already-resolved migration-hygiene concern, identical in pattern to what migrations 030/032/033/034 do. Flagged as a WARNING only because it adds cognitive load when reading migration 035 in isolation.

**No action required** (the DB is correct); note for completeness.

### 🟢 G3 — No per-session date-range query index on `ice_depth_sessions (layout_id, submitted_at)`

**Location:** `supabase/migrations/00000000000014_ice_depth_schema.sql`

The history and analytics tab queries filter on both `facility_id` / `layout_id` and `submitted_at` range. The existing indexes are:
- `idx_ice_depth_sessions_facility_submitted (facility_id, submitted_at desc)` ✅
- `idx_ice_depth_sessions_layout_submitted (layout_id, submitted_at desc)` ✅

Coverage is adequate for current load (10 sessions in the live DB). Flagged only because the analytics query (`layout_id + submitted_at range`) joins via `layout_id` without a `facility_id` prefix; the covering index is `(layout_id, submitted_at desc)` which is correct. No action required today; covered if data grows.

---

## Critical Findings

**None.**

Ground rule verification:
- 🚫 No `<input type="file">`, `FileReader`, `storage.upload`, camera, or image upload anywhere in the ice-depth module (staff or admin). ✅
- 🚫 No `as any` or `@ts-ignore` in the module. ✅
- 🚫 No tRPC. ✅
- 🚫 No AI/LLM imports. ✅
- `facility_id` is never client-supplied: all writes derive it server-side from `profile.facility_id` (checked via `requireUser()` / `requireAdmin()` + `resolveFacility()`). ✅

---

## Checklist

| Check | Status | Evidence |
|---|---|---|
| **SCHEMA: `ice_depth_*` tables exist** | ✅ PASS | Mig 14: `ice_depth_settings`, `_layouts`, `_points`, `_sessions`, `_measurements`, `_followup_notes`; Mig 35: `_change_log`; Mig 83: `_rinks`. All confirmed in SCHEMA-report live inventory. |
| **SCHEMA: readings have `facility_id`** | ✅ PASS | `ice_depth_sessions.facility_id`, `ice_depth_measurements.facility_id` — both direct FKs to `facilities.id`. |
| **SCHEMA: rink/layout identifier** | ✅ PASS | `ice_depth_sessions.layout_id → ice_depth_layouts`, `ice_depth_layouts.rink_id → ice_depth_rinks` (mig 83). |
| **SCHEMA: `user_id` / `employee_id`** | ✅ PASS | `ice_depth_sessions.employee_id → employees`. |
| **SCHEMA: `recorded_at` / `submitted_at`** | ✅ PASS | `ice_depth_sessions.submitted_at timestamptz not null`. |
| **SCHEMA: zone/position identifier** | ✅ PASS | `ice_depth_measurements.point_id → ice_depth_points`, plus `point_number_snapshot` + `x_snapshot`/`y_snapshot` for historical integrity. |
| **SCHEMA: `depth_value`** | ✅ PASS | `ice_depth_measurements.depth_value numeric not null` with `CHECK (depth_value >= 0)` (mig 138). |
| **SCHEMA: NO file/photo/image/storage column** | ✅ PASS | SCHEMA-report confirmed. Columns on `ice_depth_measurements`: `id, facility_id, session_id, point_id, point_number_snapshot, label_snapshot, x_snapshot, y_snapshot, depth_value, severity, created_at` — no file column. |
| **SCHEMA: historical readings queryable by layout + date range** | ✅ PASS | `idx_ice_depth_sessions_facility_submitted (facility_id, submitted_at desc)` + `idx_ice_depth_sessions_layout_submitted (layout_id, submitted_at desc)` — both present. |
| **UI: depth entry form exists** | ✅ PASS | `src/app/reports/ice-depth/_components/submission-form.tsx` — two-phase (measure → review) form with tap-driven rink SVG, popover per-point numeric input, offline queuing. |
| **UI: zone/position from admin config (not hardcoded)** | ✅ PASS | Points loaded from `ice_depth_points` (server-side) keyed by `layout_id + facility_id`; positions are `x_position/y_position` floats set by admin in layout editor. |
| **UI: historical readings view** | ✅ PASS | Admin history tab in `src/app/admin/ice-depth/_components/history-tab.tsx` with filterable session list and drilldown detail view. |
| **UI: trend display exists** | ✅ PASS | Analytics tab — per-point rollup table, heat-map SVG overlay, daily-activity strip chart (`TrendStrip` in `analytics-tab.tsx`). |
| **UI: NO file input / camera / upload** | ✅ PASS | Grep confirmed zero matches for `type="file"`, `FileReader`, `storage.upload`, `camera` under both `reports/ice-depth` and `admin/ice-depth`. `logo_url` is `type="url"` text, not a file input. |
| **ADMIN: configure zones/positions per layout** | ✅ PASS | `src/app/admin/ice-depth/_components/layout-editor.tsx` — click-to-place points on the rink SVG; drag, rename, reorder, renumber, deactivate. |
| **ADMIN: set min/max depth thresholds** | ✅ PASS | `SettingsTab` + `updateIceDepthSettings` action — `low_threshold` / `high_threshold` with app-side `<` validation and DB-level `CHECK (low_threshold < high_threshold)` (mig 138). |
| **ADMIN: threshold breach triggers visual warning** | ✅ PASS | Live severity color in the measure-phase popover (`SEVERITY_COLOR` + `SEVERITY_LABEL`), summary pills in review phase, and per-point severity dots in the done page. Admin analytics show badge variants `error`/`warning` for low/high counts. |
| **ROLE: staff submit (server-enforced)** | ✅ PASS | `currentUserCan(supabase, "ice_depth", "submit")` checked in `actions.ts:75` and replayed in `offline.ts:51`. RLS INSERT on `ice_depth_sessions` enforces `employee_id = current_employee_id()`. |
| **ROLE: supervisor+ view history** | ✅ PASS | Admin history tab is behind `requireAdmin()`. Session SELECT RLS allows `facility_id = current_facility_id() AND has_module_access('ice_depth')` for all authenticated module-access users; write/delete is super_admin-only. |
| **OFFLINE: SW-queue write path present** | ✅ PASS | `handleReviewSubmit` in `submission-form.tsx` calls `enqueueSubmission()` when offline; `handleIceDepthReplay` in `_lib/offline.ts` is the corresponding replay handler registered in `/api/offline-sync/route.ts`. |

---

## Files Needing Work

| File | Finding |
|---|---|
| `src/app/admin/ice-depth/actions.ts` (line 914-921) | G1: add comment documenting super_admin cross-facility delete intent; low risk today. |
| `supabase/migrations/00000000000035_ice_depth_change_log.sql` (line 51) | G2: historical; do not edit — already superseded by mig 071. Note only. |
