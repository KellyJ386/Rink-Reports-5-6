# RinkReports 5-6 — Database Schema Audit (Agent-SCHEMA)

- **Project audited (MCP):** `bqbdgwlhbhabsibjgwmk` (only this project).
- **Mode:** AUDIT-ONLY. No code/migration/schema writes were performed. Only this report + the DONE marker were written.
- **Date:** 2026-06-17.
- **Live public-schema tables:** **105** (all RLS-enabled).
- **Generated types:** `src/types/database.ts` (NOT `src/lib/database.types.ts`) — 104 tables in its `Tables` block.

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK · ℹ️ INFO

---

## Executive summary / top findings

1. 🔴 **Migration history divergence — local files 141/142/143 are NOT applied to the live project.** The remote `list_migrations` ends at `20260614110137` (= local `…140_schedule_shifts_no_double_booking`). Local migrations `…141_facility_spaces_shared_admin`, `…142_accidents_use_facility_spaces`, `…143_air_quality_use_facility_spaces` have **no row in the remote migration history**. This single fact explains every type/live mismatch below.
2. 🟡 **`air_quality_locations` exists in the LIVE DB (0 rows, 3 indexes) but is ABSENT from `src/types/database.ts`.** Per spec rules this would read as a "stale type" (live table missing from types), but the root cause is #1: `database.ts` was regenerated from a fully-migrated local DB (post-143, where mig 143 `drop table … air_quality_locations` ran), while the live DB is pre-143 and still has the table. So **types are ahead of the live DB**, not behind it.
3. 🔴 **Live FK targets contradict the generated types for accidents & air-quality location refs.** Live `accident_reports.location_dropdown_id → accident_dropdowns` and `air_quality_equipment.location_id → air_quality_locations`; the committed migrations (142/143) and `database.ts` expect `→ facility_spaces`. Code typed against `database.ts` that joins these to `facility_spaces` will break against the live DB until 141–143 are applied.
4. 🟡 **Duplicate migration prefix `00000000000139`** in `supabase/migrations/`: both `…139_daily_report_rename_operational_to_daily.sql` and `…139_scheduling_expiry.sql` share the prefix, violating the "one file per monotonic prefix" rule in CLAUDE.md. (They were applied remotely under distinct timestamp versions `…`/`20260614110130` era, so they did apply — but the on-disk collision is a real hygiene defect and a re-`supabase db reset` ordering hazard.)
5. 🟢 **55 foreign-key columns lack a covering index** (full list below). All are low-cardinality / mostly-empty tables today, hence MINOR, but they are real future-scaling gaps.
6. ✅ **FK integrity intact** — zero FK constraints reference a missing/dropped relation (orphan-constraint check returned empty).
7. ✅ **facility_id coverage is complete** for every user-facing table. Only 4 tables lack a `facility_id` column and all are justified: `facilities` (is the tenant root), `information_requests`, `rate_limit_counters` (infra), see §F.
8. ✅ **No photo/file/attachment column on `incident_reports` or any `ice_depth_*` table** — confirms ground rule #6 (no photo in Ice Depth / Incident).

---

## STEP A — Live schema overview

- 105 base tables in `public`. **Every one has RLS enabled** (`relrowsecurity = true`) — verified via `pg_class`.
- All tables use a single-column `id uuid` primary key **except `rate_limit_counters`**, which has a composite PK `(bucket, identifier, window_start)` (no `id`).
- Indexes: per-table counts captured (see Table inventory). Index totals range 2–9 per table; hottest: `incident_reports` (9), `schedule_shifts` (9), `ice_operations_submissions` (7), `schedule_swap_requests` (7).
- Approximate row counts from `pg_stat_user_tables` (see inventory). The DB is essentially a single-facility seed/dev dataset: `facilities`=1, `employees`=103, `users`=5, `user_permissions`=140, config/seed tables populated, most submission tables at 0.

---

## STEP B — Migration timeline (high level)

Flat numerically-ordered set, on-disk prefixes `00000000000001 … 00000000000143` (144 files due to the dup-139). Major table births:

| Mig | Brings into being |
|---|---|
| 0001–0006 | extensions, **backbone schema** (facilities, users, employees, roles, departments), helper fns, **backbone RLS**, system roles seed, hardening |
| 0007 | daily reports (`daily_report_*`) |
| 0008 | incidents (`incident_reports`, `incident_types`, `incident_severity_levels`, witnesses) |
| 0009 | communications (`communication_*`) |
| 0010 | accidents (`accident_reports`, `accident_dropdowns`, witnesses) |
| 0011 | refrigeration (`refrigeration_sections/equipment/fields/thresholds/reports/report_values`) |
| 0012 | air quality (`air_quality_locations`, `_reading_types`, `_thresholds`, `_equipment`, `_reports`, `_readings`, `_settings`) |
| 0013 | ice operations (`ice_operations_submissions`, equipment, fuel types, rinks, circle-check) |
| 0014 | ice depth (`ice_depth_sessions`, `_points`, `_measurements`, `_layouts`, settings) |
| 0015 | scheduling (`schedule_shifts`, templates, swaps, time-off, availability) |
| 0018/0019 | retention_settings, export_settings |
| 0029/0030 | module permission helper + submission RLS module permissions |
| 0031 | offline_sync_queue |
| 0032–0035 | per-module change-log tables |
| 0045/0047 | notification_outbox (+ drain) |
| 0048 | pdf_attachments |
| 0056/0057 | employee_invites, employee_certifications |
| 0061 | **fix_phantom_table_names** — patched migs 30/33/43 that referenced never-existent `air_quality_submissions` / `ice_operation_reports`; recreated policies on the real tables. (Good prior cleanup; relevant precedent.) |
| 0077/0078 | **user_permissions** (replaces legacy permission model) |
| 0079–0082 | role_permission_defaults + auto-seed |
| 0083 | ice_depth_rinks |
| 0085 | facility_documents |
| 0087 | **retire gm/supervisor roles** (see spec/reality gap below) |
| 0088 | information_requests |
| 0094 | rate_limit (rate_limit_counters) |
| 0099 | **drop dead legacy permission tables** (`module_permissions` removed; `module_area_permissions` + `role_module_permission_defaults` retained) |
| 0101 | facility_spaces |
| 0102–0105 | incident_activities, incident redesign columns, incident_report children/spaces |
| 0107/0108 | employee_job_areas + assignments |
| 0115–0120 | scheduling job-area, cert requirements, assignment violations, RLS/grants remediation, auto-seed |
| 0116 | job_area_certification_requirements |
| 0127/0128 | schedule_availability job_area, scheduling grid additions |
| 0136/0137 | scheduling swap/publish RPCs, facility tz engine + open claims |
| 0138 | ice_depth integrity + purge |
| **0139 (×2)** | daily-report Operational→Daily rename **AND** scheduling_expiry — **duplicate prefix** 🟡 |
| 0140 | schedule_shifts no-double-booking |
| **0141** | facility_spaces shared admin — **NOT applied to live DB** 🔴 |
| **0142** | accidents use facility_spaces (re-point `accident_reports` location/* dropdown FKs) — **NOT applied to live DB** 🔴 |
| **0143** | air_quality use facility_spaces + `drop table air_quality_locations` — **NOT applied to live DB** 🔴 |

### Remote vs on-disk version stamping (important)
Remote `list_migrations` shows prefixes `…001`–`…122` as zero-padded, then **switches to timestamp stamps** (`20260603012740` … `20260614110137`) for everything from on-disk `…123` onward. The remote list **terminates at `20260614110137`** which corresponds to on-disk `…140_schedule_shifts_no_double_booking`. Therefore on-disk `…141/142/143` are unapplied remotely. Renames/drops in those three files are **not reflected in the live schema** but **are reflected in `database.ts`** → the divergence in findings #2/#3.

---

## STEP C — Type sync (`src/types/database.ts` vs live)

Diff of table-name sets (Tables block only):

- **Phantom types (in types, not in live):** none ✅
- **Stale/missing (in live, not in types):** `air_quality_locations` 🟡 — live has it; types do not. (Cause: types generated post-143 where the table is dropped; live is pre-143.) Per spec this is the "🟡 stale" bucket (table in live not in types).
- **Beyond table presence**, the FK shape also diverges (§E / finding #3): `database.ts` types `accident_reports` / `air_quality_equipment` location refs against `facility_spaces`, but live FKs still point at `accident_dropdowns` / `air_quality_locations`.

**Net:** `database.ts` is NOT a faithful representation of the live `bqbdgwlhbhabsibjgwmk` schema right now. It matches the *intended* fully-migrated state. CI (`pnpm types:check`) regenerates against a freshly-migrated local DB, so CI is green while the remote project lags 3 migrations behind. **Recommendation (for a future non-audit PR): apply migrations 141–143 to the live project, OR confirm the live project is intentionally pinned pre-143.**

---

## STEP D — Required tables (spec name → ACTUAL name, FOUND / NOT BUILT)

| Spec / required concept | Actual table(s) | Status |
|---|---|---|
| facilities | `facilities` | ✅ FOUND |
| profiles / users | `users` (+ `auth.users`), staff identity in `employees` | ✅ FOUND |
| facility config | `*_settings` per module (`refrigeration_settings`, `air_quality_settings`, `ice_depth_settings`, `ice_operations_settings`, `schedule_settings`, `export_settings`, `retention_settings`) | ✅ FOUND |
| facility modules / module access | `module_area_permissions`, `user_permissions`, `role_permission_defaults`, `role_module_permission_defaults` (+ helper fns `has_module_access` etc.) | ✅ FOUND |
| sync / offline queue | `offline_sync_queue` | ✅ FOUND |
| daily reports submission | `daily_report_submissions` + `daily_report_submission_items` | ✅ FOUND |
| daily tab/checklist config | `daily_report_areas`, `daily_report_templates`, `daily_report_checklist_items` (+ `daily_report_notes`) | ✅ FOUND |
| ice depth readings | `ice_depth_measurements` (per-point) + `ice_depth_sessions` (header) | ✅ FOUND |
| ice depth config | `ice_depth_rinks`, `ice_depth_layouts`, `ice_depth_points`, `ice_depth_settings` | ✅ FOUND |
| ice operations log | `ice_operations_submissions` | ✅ FOUND |
| ice operation types / circle-check | `ice_operations_circle_check_items/_results/_templates/_template_items` | ✅ FOUND |
| ice operations equipment types | `ice_operations_equipment`, `ice_operations_fuel_types`, `ice_operations_rinks` | ✅ FOUND |
| refrigeration logs | `refrigeration_reports` + `refrigeration_report_values` | ✅ FOUND |
| refrigeration compressor/equipment config | `refrigeration_sections`, `refrigeration_equipment`, `refrigeration_fields` | ✅ FOUND |
| refrigeration thresholds | `refrigeration_thresholds` | ✅ FOUND |
| air quality readings | `air_quality_readings` + `air_quality_reports` | ✅ FOUND |
| air quality thresholds | `air_quality_thresholds` (+ `air_quality_compliance_rules`, `air_quality_reading_types`) | ✅ FOUND |
| incident reports | `incident_reports` (+ `incident_types`, `incident_severity_levels`, `incident_activities`, `incident_witnesses`, `incident_report_spaces`) | ✅ FOUND |
| incident **no photo/file column** | confirmed — `incident_reports` has NO photo/image/file/attachment/url column (the only `*media*` substring hit is inside `immediate_actions`) | ✅ CONFIRMED (ground rule #6) |
| scheduling: schedule_shifts | `schedule_shifts` | ✅ FOUND |
| scheduling templates | `schedule_templates` + `schedule_template_shifts` | ✅ FOUND |
| scheduling job-area assignments | `employee_job_areas` + `employee_job_area_assignments` (+ `schedule_shifts.job_area_id`, `schedule_availability.job_area_id`) | ✅ FOUND |
| scheduling job-area required certs | `job_area_certification_requirements` (+ `employee_certifications`) | ✅ FOUND |

**No required module is NOT BUILT.** All spec concepts map to real tables.

---

## STEP E — FK integrity & missing-index findings

### Integrity ✅
Every FK references an existing relation. The orphan-constraint check (FK whose `confrelid` is not a live table) returned **empty**.

### 🟢 FK columns missing a covering index (first-column index absent) — 55 total
(Format `table.column → ref_table`.) MINOR today (tables mostly empty); recommend indexes before scale-out, especially the scheduling/communication ones.

```
accident_body_part_selections.body_part_dropdown_id → accident_dropdowns
accident_change_log.employee_id → employees
accident_followup_notes.employee_id → employees
accident_reports.activity_dropdown_id → accident_dropdowns
accident_reports.location_dropdown_id → accident_dropdowns
accident_reports.primary_injury_type_dropdown_id → accident_dropdowns
air_quality_equipment.location_id → air_quality_locations
air_quality_followup_notes.employee_id → employees
air_quality_readings.threshold_id → air_quality_thresholds
air_quality_reports.equipment_id → air_quality_equipment
air_quality_thresholds.location_id → air_quality_locations
audit_logs.actor_employee_id → employees
communication_alerts.created_by_employee_id → employees
communication_alerts.resolved_by_employee_id → employees
communication_audit_log.actor_employee_id → employees
communication_messages.template_id → communication_templates
communication_recurring_reminders.target_group_id → communication_groups
communication_recurring_reminders.template_id → communication_templates
communication_routing_rules.target_department_id → departments
communication_routing_rules.target_employee_id → employees
communication_routing_rules.target_group_id → communication_groups
daily_report_notes.employee_id → employees
employee_invites.invited_by → auth.users
employees.created_by → users
facility_documents.uploaded_by → employees
ice_depth_followup_notes.employee_id → employees
ice_operations_circle_check_results.checklist_item_id → ice_operations_circle_check_items
ice_operations_circle_check_templates.fuel_type_id → ice_operations_fuel_types
ice_operations_followup_notes.employee_id → employees
incident_change_log.employee_id → employees
incident_change_log.facility_id → facilities
incident_followup_notes.employee_id → employees
job_area_certification_requirements.job_area_id → employee_job_areas
notification_outbox.rule_id → communication_routing_rules
profile_audit_log.edited_by → users
refrigeration_followup_notes.employee_id → employees
refrigeration_followup_notes.field_id → refrigeration_fields
refrigeration_report_values.equipment_id → refrigeration_equipment
refrigeration_report_values.threshold_id → refrigeration_thresholds
refrigeration_thresholds.equipment_id → refrigeration_equipment
role_permission_defaults.role_id → roles
schedule_notifications.shift_id → schedule_shifts
schedule_notifications.swap_id → schedule_swap_requests
schedule_notifications.time_off_id → schedule_time_off_requests
schedule_open_shifts.approved_by_employee_id → employees
schedule_publish_events.published_by_employee_id → employees
schedule_publish_requests.decided_by_employee_id → employees
schedule_publish_requests.published_event_id → schedule_publish_events
schedule_shifts.published_by_employee_id → employees
schedule_shifts.recurring_parent_id → schedule_shifts
schedule_shifts.template_origin_id → schedule_templates
schedule_swap_requests.manager_approver_employee_id → employees
schedule_swap_requests.target_shift_id → schedule_shifts
schedule_template_shifts.department_id → departments
schedule_time_off_requests.approved_by_employee_id → employees
```

### 🔴 FK shape divergence (live vs intended/types)
- `accident_reports.location_dropdown_id` → **live: `accident_dropdowns`** / intended (mig 142 + types): `facility_spaces`.
- `air_quality_equipment.location_id` → **live: `air_quality_locations`** / intended (mig 143 + types): `facility_spaces`.
- `air_quality_thresholds.location_id` → **live: `air_quality_locations`** / intended: `facility_spaces`.
Root cause = unapplied migrations 142/143 (finding #1). Risk: runtime joins typed via `database.ts` will not match the live DB.

---

## STEP F — facility_id coverage

Every public table was checked for a `facility_id` column. **101 of 105 tables have `facility_id uuid` FK → `facilities.id`.** The 4 without are all justified:

| Table | Scoping path | Verdict |
|---|---|---|
| `facilities` | IS the tenant root (`id` is the facility) | ✅ OK |
| `information_requests` | no `facility_id` column | ℹ️ NOTE — verify scoping (see below) |
| `rate_limit_counters` | infra table, composite PK `(bucket, identifier, window_start)`, no tenant data | ✅ OK (infra) |
| (only 3 tables truly lack the column; `facilities` is the 4th by definition) | | |

**No user-facing report/config table is missing a facility scoping path** → no 🔴 for §F. Every module submission/config/log/threshold/setting table carries a direct `facility_id → facilities.id` FK (not just a parent chain), which is the strongest possible scoping for RLS.

- ℹ️ **`information_requests`** (created mig 0088, 0 rows): no `facility_id` and no outbound FK detected in the dump. If this table ever holds tenant-scoped data, it has **no facility scoping path** and would be 🟡/🔴. Flagged for Wave-2 (Communications/Admin) follow-up to confirm whether it is global-by-design or an unscoped gap. Currently empty so no live exposure.

---

## Ground-rule observations (schema-relevant)

- ✅ **#6 no photo in Ice Depth / Incident** — confirmed; no media/file/attachment/url column on `incident_reports`, `ice_depth_sessions`, `ice_depth_points`, `ice_depth_measurements`. Ice-depth captures numeric `depth_value` + `severity` + snapshot coords only.
- ℹ️ **#7 role hierarchy spec/reality gap (report, do not punish):** the spec's `super_admin→org_admin→facility_manager→supervisor→staff` chain does NOT match reality. Mig 0058 dropped `gm` from admin lists; mig 0087 **retired gm + supervisor roles**; the live model is a `user_permissions` + `role_permission_defaults` matrix (live `roles`=5, `user_permissions`=140 rows) resolved by helper fns (`effective_module_permission`, `has_module_access`, `has_module_admin_access`, `has_area_access`). This is an intentional design evolution, correctly reflected in the schema. **Gap is in the spec, not the code.**
- ℹ️ **#1 facility_id never client-supplied** — schema enforces direct `facility_id` FKs everywhere; whether it is server-set (vs client-supplied) is an application-layer concern for module agents to verify, but the column/FK substrate supports correct scoping.

---

## Table inventory (for Wave-2 agents)

Columns: **Table** · **RLS** · **facility_id** (direct FK→facilities.id unless noted) · **idx count** · **approx rows**. All RLS = ON. PK = `id` unless noted. Outbound FK detail is in the STEP-E section / parsed dump; this table is the quick scoping+volume reference.

| Table | RLS | facility_id | idx | rows |
|---|---|---|---|---|
| accident_body_part_selections | ON | yes | 4 | 0 |
| accident_change_log | ON | yes | 3 | 0 |
| accident_dropdowns | ON | yes | 3 | 54 |
| accident_followup_notes | ON | yes | 3 | 0 |
| accident_reports | ON | yes | 5 | 0 |
| accident_witnesses | ON | yes | 4 | 0 |
| accident_workers_comp_settings | ON | yes | 2 | 0 |
| air_quality_change_log | ON | yes | 5 | 0 |
| air_quality_compliance_rules | ON | yes | 2 | 5 |
| air_quality_equipment | ON | yes | 3 | 0 |
| air_quality_followup_notes | ON | yes | 3 | 0 |
| air_quality_locations | ON | yes | 3 | 0 | *(live-only; missing from types — see #2)* |
| air_quality_reading_types | ON | yes | 3 | 3 |
| air_quality_readings | ON | yes | 5 | 0 |
| air_quality_reports | ON | yes | 5 | 0 |
| air_quality_settings | ON | yes | 2 | 1 |
| air_quality_thresholds | ON | yes | 5 | 3 |
| audit_logs | ON | yes | 6 | 553 |
| communication_acknowledgements | ON | yes | 5 | 0 |
| communication_alerts | ON | yes | 5 | 0 |
| communication_audit_log | ON | yes | 3 | 0 |
| communication_group_members | ON | yes | 4 | 0 |
| communication_groups | ON | yes | 4 | 0 |
| communication_messages | ON | yes | 3 | 0 |
| communication_recipients | ON | yes | 6 | 0 |
| communication_recurring_reminders | ON | yes | 2 | 0 |
| communication_routing_rules | ON | yes | 4 | 0 |
| communication_templates | ON | yes | 3 | 0 |
| daily_report_areas | ON | yes | 4 | 17 |
| daily_report_checklist_items | ON | yes | 3 | 506 |
| daily_report_notes | ON | yes | 3 | 0 |
| daily_report_submission_items | ON | yes | 5 | 18 |
| daily_report_submissions | ON | yes | 6 | 2 |
| daily_report_templates | ON | yes | 3 | 51 |
| departments | ON | yes | 3 | 5 |
| employee_certifications | ON | yes | 4 | 0 |
| employee_invites | ON | yes | 4 | 0 |
| employee_job_area_assignments | ON | yes | 5 | 212 |
| employee_job_areas | ON | yes | 4 | 10 |
| employees | ON | yes | 6 | 103 |
| export_settings | ON | yes | 2 | 0 |
| facilities | ON | **n/a (tenant root)** | 3 | 1 |
| facility_documents | ON | yes | 3 | 0 |
| facility_spaces | ON | yes | 4 | 0 |
| ice_depth_change_log | ON | yes | 5 | 0 |
| ice_depth_followup_notes | ON | yes | 3 | 0 |
| ice_depth_layouts | ON | yes | 5 | 2 |
| ice_depth_measurements | ON | yes | 5 | 152 |
| ice_depth_points | ON | yes | 5 | 61 |
| ice_depth_rinks | ON | yes | 4 | 2 |
| ice_depth_sessions | ON | yes | 5 | 10 |
| ice_depth_settings | ON | yes | 2 | 1 |
| ice_operation_change_log | ON | yes | 5 | 0 |
| ice_operations_circle_check_items | ON | yes | 2 | 44 |
| ice_operations_circle_check_results | ON | yes | 5 | 0 |
| ice_operations_circle_check_template_items | ON | yes | 3 | 0 |
| ice_operations_circle_check_templates | ON | yes | 3 | 0 |
| ice_operations_equipment | ON | yes | 4 | 3 |
| ice_operations_followup_notes | ON | yes | 3 | 0 |
| ice_operations_fuel_types | ON | yes | 3 | 2 |
| ice_operations_rinks | ON | yes | 3 | 2 |
| ice_operations_settings | ON | yes | 2 | 1 |
| ice_operations_submissions | ON | yes | 7 | 3 |
| incident_activities | ON | yes | 4 | 0 |
| incident_change_log | ON | yes | 2 | 0 |
| incident_followup_notes | ON | yes | 3 | 0 |
| incident_report_spaces | ON | yes | 5 | 0 |
| incident_reports | ON | yes | 9 | 0 | *(no photo/file col — ground rule #6 ✅)* |
| incident_severity_levels | ON | yes | 4 | 4 |
| incident_types | ON | yes | 4 | 5 |
| incident_witnesses | ON | yes | 4 | 0 |
| information_requests | ON | **no** | 2 | 0 | *(no facility scoping path — ℹ️ verify §F)* |
| job_area_certification_requirements | ON | yes | 4 | 0 |
| module_area_permissions | ON | yes | 6 | 26 |
| notification_outbox | ON | yes | 3 | 0 |
| offline_sync_queue | ON | yes | 6 | 0 |
| profile_audit_log | ON | yes | 3 | 0 |
| rate_limit_counters | ON | **no (infra)** | 2 | 0 | *(composite PK bucket,identifier,window_start)* |
| refrigeration_change_log | ON | yes | 5 | 0 |
| refrigeration_equipment | ON | yes | 3 | 7 |
| refrigeration_fields | ON | yes | 5 | 56 |
| refrigeration_followup_notes | ON | yes | 4 | 0 |
| refrigeration_report_values | ON | yes | 6 | 0 |
| refrigeration_reports | ON | yes | 4 | 0 |
| refrigeration_sections | ON | yes | 3 | 6 |
| refrigeration_settings | ON | yes | 2 | 1 |
| refrigeration_thresholds | ON | yes | 4 | 19 |
| retention_settings | ON | yes | 3 | 0 |
| role_module_permission_defaults | ON | yes | 5 | 20 |
| role_permission_defaults | ON | yes | 3 | 151 |
| roles | ON | yes | 4 | 5 |
| schedule_availability | ON | yes | 4 | 0 |
| schedule_compliance_rules | ON | yes | 3 | 0 |
| schedule_notifications | ON | yes | 3 | 0 |
| schedule_open_shifts | ON | yes | 5 | 0 |
| schedule_publish_events | ON | yes | 2 | 0 |
| schedule_publish_requests | ON | yes | 3 | 0 |
| schedule_settings | ON | yes | 2 | 0 |
| schedule_shifts | ON | yes | 9 | 0 |
| schedule_swap_requests | ON | yes | 7 | 0 |
| schedule_template_shifts | ON | yes | 4 | 0 |
| schedule_templates | ON | yes | 2 | 1 |
| schedule_time_off_requests | ON | yes | 4 | 0 |
| user_permissions | ON | yes | 4 | 140 |
| users | ON | yes | 4 | 5 |

### Detailed columns for sensitive tables (ground-rule #6 evidence)

**incident_reports** — no photo/file/attachment/url column. Columns: id, facility_id, employee_id, incident_type_id, severity_level_id, location, occurred_at, reporter_name, reporter_phone (nullable), description, status, submitted_at, reviewed_at, resolved_at, archived_at, created_at, updated_at, edit_window_ends_at, activity_id, activity_other, location_other, immediate_actions. *(`immediate_actions` is free text — the only `media` substring match is inside "im**media**te"; not a media column.)*

**ice_depth_measurements** — id, facility_id, session_id, point_id, point_number_snapshot, label_snapshot, x_snapshot, y_snapshot, depth_value, severity, created_at. No photo/file column.

**ice_depth_sessions** — id, facility_id, layout_id, employee_id, notes, submitted_at, measurement_unit_snapshot, low/high_threshold_snapshot, has_low/high_reading, low/high_count, total_measurements, created_at, updated_at. No photo/file column.

**ice_depth_points** — id, facility_id, layout_id, point_number, label, x_position, y_position, sort_order, is_active, created_at, updated_at. No photo/file column.

---

## Recommendations (for future non-audit work — not actioned here)

1. 🔴 Reconcile remote project `bqbdgwlhbhabsibjgwmk` with on-disk migrations: apply `…141/142/143`, OR document that the live project is intentionally pinned at `…140`. Until then `database.ts` ≠ live schema (accidents/air-quality location FKs + `air_quality_locations` presence).
2. 🟡 Resolve the duplicate `00000000000139_*` prefix (rename one to `…139a`/renumber) per the "one file per monotonic prefix" rule.
3. 🟢 Add covering indexes on the 55 FK columns listed in §E before any table grows.
4. ℹ️ Confirm `information_requests` scoping intent (global vs missing `facility_id`).
