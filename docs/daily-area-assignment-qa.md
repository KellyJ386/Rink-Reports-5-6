# Daily Reports — Area Assignment & Routing: Phase 7 QA Gate

**Date:** 2026-07-18 · **Branch:** `claude/daily-reports-area-assignment-to8r41` · **Scope:** migrations 182–185 + the daily/admin/dashboard/offline surfaces added in Phases 1–6 (design + phase log: `docs/daily-area-assignment-discovery.md`).

Verification environment: local PostgreSQL 16 with the Supabase-surface shim used throughout this build (validated by the committed `src/types/database.ts` regenerating byte-identical from it), rebuilt **from scratch** for this gate: all **185 migrations apply cleanly in order** on an empty database.

## Checklist

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Existing flow unchanged when unconfigured (zero owners, zero assignments, flag off/absent) | **PASS** | `daily_area_assignment_allows` short-circuits open when no `daily_report_settings` row or flag false; `/reports/daily` renders the pre-feature console when `routingEnabled` is false; dashboard widget returns null. Harness: the pre-existing daily submit/append-only assertions run **before** routing is enabled in the fixture and still pass; "flag OFF → pre-feature behavior" asserted twice (DAR + ten-areas sim). |
| 2 | 10 areas functioning assigned, open, and mixed | **PASS** | Rollback-wrapped simulation (scratch script, this gate): facility with 10 areas — 4 assigned to staff X, 3 to staff Y, 3 open. 18/18 checks: X submits own+open (7), blocked from Y's (3); Y submits own, cannot see X's restricted rows, sees open-area rows; supervisor sees all 8 submissions and the 7-assigned/3-open board; flag off reverts everything. |
| 3 | Tabs save independently; day still closes at end of day | **PASS** | Submission pipeline untouched (append-only INSERT path; the only change is the `business_date` stamping trigger, which fills NULL only). Harness append-only assertions ("second same-day row allowed", "both rows coexist") still green. Day close remains the implicit facility-local rollover; Phase 5 adds recording (snapshots), never blocking (D5). |
| 4 | Phase 2 adversarial RLS suite re-run green | **PASS** | Full `supabase/tests/rls_isolation.sql` on the fresh rebuild: **333 assertions, 0 failures** — including DAR (39: staff-vs-staff, multi-assignee, revert-to-open on supersede, edit/admin bypass, legacy NULL-date, stamping-trigger bypass closure, flag toggling), DAR-3 (14: engine, published-only, idempotency, notification isolation/forgery, caller gate) and DAR-5 (13: past-date lock, snapshot freeze/immutability, privilege gates, standing-area-scoped snapshot reads). |
| 5 | Scheduling: no writes; published-only; publish-lock status | **PASS** | Grep sweep over migrations 182–185 and every TS feature file: zero scheduling-table writes; the only `schedule_shifts` access is the engine's read joined on `status = 'published'`; `employee_job_areas` is a read-only catalog select in the admin loader. DAR-3 proves a **draft** shift produces no assignment. Publish-lock bypass status: **closed** at the DB boundary by `schedule_shifts_publish_lock()` (migrations 148/164/181, per `docs/scheduling-audit.md`) — unchanged by this feature, which adds no scheduling write paths that could regress it. |
| 6 | Multi-tenant isolation on all new tables | **PASS** | Cross-facility SELECT-returns-zero + INSERT-denied assertions for all six new tables (`report_area_assignments`, `area_default_owners`, `daily_area_job_area_map`, `daily_area_assignment_snapshots`, `daily_report_settings`, `daily_report_assignment_notifications`), including edit-tier and module-admin actors attempting cross-facility assignment writes, and endpoint facility-match on the job-area bridge. |
| 7 | Offline: My Areas from cache in airplane mode; stale-assignment rejection UX | **PASS (code + unit) / device pass pending** | Cache freshness logic (business-date keyed, timezone-aware, near-midnight divergence) unit-tested (4 cases); the offline view mirrors the proven `/offline-schedule` pattern verbatim; replay rejection maps RLS/access denial to a permanent 422 with assignment-specific copy surfaced on `/reports/offline-queue`. Real-device passes added to `docs/QA-DEVICE-CHECKLIST.md` ("Area assignment routing" section) for the standard pre-launch hardware run — headless verification cannot exercise airplane mode/SW installs. |
| 8 | Notifications fire on assign/reassign only; no spam on re-runs | **PASS** | Engine notifies only rows it actually inserts; first-materialization-wins makes re-runs no-ops — DAR-3 asserts zoe holds exactly **one** notification after two resolution runs. Manual actions notify the computed delta only (`diffAssignees`, unit-tested; a no-change save inserts nothing). |
| 9 | Snapshot immutability post-lock | **PASS** | Snapshots have **no client write policies** (INSERT rejected even for module admins; UPDATE matches 0 rows); the writer is insert-only (`ON CONFLICT DO NOTHING`); DAR-5 tampers with a closed day's assignment rows as `postgres` and proves the frozen record is unchanged; the past-date trigger additionally blocks end-user edits of closed-day assignment rows outright. |
| 10 | Per-facility feature flag; disabling reverts entirely | **PASS** | `daily_report_settings.assignment_routing_enabled` (default **false**; absent row = off). Asserted live in both directions: flag off → unassigned staff can submit into an assigned area and see all rows (pre-feature behavior); flag re-enabled → restriction resumes. Admin toggle write-gated to the daily module admin; staff toggle attempt affects 0 rows. UI reverts (console, widget, board notice) verified by branch logic + build. |

## Toolchain (this gate, final state of the branch)

- `pnpm test` — 517/517 (44 files; includes assignment compute, cache freshness, and all pre-existing suites)
- `pnpm lint`, `tsc --noEmit` — clean
- `pnpm build` — clean (all routes incl. `/reports/daily/assignments`, `/offline-daily`, `/api/cron/snapshot-daily-assignments`)
- `pnpm types:check` — `src/types/database.ts` byte-fresh against the fully-migrated schema

## Known limits / follow-ups

Resolved after the initial gate (same branch):

1. ~~Schedule changes don't auto-flow after first materialization~~ — **resolved** by migration 187: `resync_daily_area_assignments()` + the board's "Re-sync from schedule" button (edit/admin tier; manual overrides never touched; empty schedule leaves defaults standing; delta notifications; past dates rejected; explicit re-sync repopulates a previously opened-up area by design). Harness section "DAR-7" (9 assertions).
2. ~~Staff draft-shift visibility via my-schedule~~ — **resolved**: `/reports/scheduling/my-schedule` now hard-filters drafts in both views; the "All" status option means published + cancelled.
3. ~~No admin-side locked-day view~~ — **resolved**: the shared `AssignmentRecordCard` renders on the admin Submissions tab (list view) as well as staff history.
4. ~~No snapshot/assignment retention~~ — **resolved** by migration 186: the retention-aware `purge_old_daily_reports()` now also purges day-scoped routing rows (assignments, snapshots, notifications) on the same per-facility `keep_days`; standing config is never purged.
5. ~~CLAUDE.md staleness~~ — refreshed (cron routes documented, migration count).

Still open (require a human or the production environment):

- **Device checklist items** (§7 above) need the standard pre-launch hardware pass.
- **Production env confirmation**: `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` must be present in the deploy environment for the snapshot cron route.
- **Tennity configuration + flag-on** (default owners / job-area mapping / threshold) — product decisions, then flip the flag. Rollout note for whoever runs scheduling: publish the schedule **before** a day starts (or use the board's re-sync button after late publishes).
