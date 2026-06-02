# Phase 5 — Table Partitioning Plan

> **Status: plan only.** No DDL has been applied. Partitioning is heavy and
> largely irreversible on a populated table, so this document is for review and
> a product decision first — not a blind apply.

## Why partition

Two costs bite at ~1,000 facilities with a 7-year retention requirement:

- **Purge cost.** Today `purge_old_*()` does per-facility
  `DELETE WHERE created_at < cutoff`. That means row-by-row deletes, index
  churn, and autovacuum bloat on every run. With time-range partitions,
  expiring a window becomes a near-instant `DROP`/`DETACH PARTITION` — no bloat.
- **Scan cost.** Admin views filter `facility_id = … AND created_at` ranges.
  Native partition pruning lets the planner skip every partition outside the
  queried window. (Monthly partitions also bound the super-admin global
  `created_at` scan by time window — a secondary benefit surfaced by the
  load-test finding, which postdated the original draft of this plan.)

## What gets partitioned

Append-only, facility-scoped, `created_at`-keyed tables, in priority order:

1. **`audit_logs`** — the pilot. Fastest growth, pure append, no FK children.
2. **The 6 change-log tables** — refrigeration, air-quality, ice-operations,
   ice-depth, accident, communication.
3. **`ice_depth_measurements`** — high per-session row multiplier.

**Explicitly deferred:** `*_report` / `*_submissions` / `*_readings`. They have
FK children and are edited (not pure append), so they carry higher risk.

## The recommended scheme

- **RANGE partition on `created_at`, monthly, rolling** — ~84 partitions over 7
  years. Monthly means a purge drops ~1/84th at a time, and recent-window
  queries touch only 1–2 partitions.
- **Composite PK `(id, created_at)`** — Postgres requires the partition column
  in every unique/PK constraint.
- **`pg_partman` + `pg_cron`** (both first-class on Supabase) to automate
  partition creation + retention, replacing the hand-rolled `purge_old_*`
  functions.

## Gotchas (why this needs review, not a blind apply)

- **Can't convert a populated table in place.** Requires the
  create-twin → attach partitions → copy → atomic name-swap → re-point
  FKs/RLS/triggers/grants dance. It's a maintenance-window migration even at
  today's tiny row counts, because the cutover must preserve the audit-trigger
  wiring (migrations 41/46/93) and RLS exactly.
- **PK change `id` → `(id, created_at)`** ripples to anything referencing these
  tables. Verified today that no FK points at `audit_logs` or the change logs
  (leaf tables), so it's safe — but re-verify per table.
- **RLS carries over** to the partitioned parent automatically (no policy
  rewrite), but `rls_isolation.sql` should add an assertion that a child
  partition can't leak cross-facility.
- **Retention semantics change.** `purge_old_*` is per-`keep_days`-per-facility;
  partition-drop is per-time-window across all facilities. This is the one open
  product decision (see below).

## Phased rollout

1. **Pilot on `audit_logs` alone** → verify in prod for a week.
2. **Roll the 6 change-log tables together** (identical shape).
3. **`ice_depth_measurements`** (verify its session FK direction first).
4. **Replace `purge_old_*` with `pg_partman` retention** once everything's
   partitioned.

## The one decision blocking step 1

**Per-facility `keep_days` vs whole-partition retention.** If facilities must
keep different windows, partition-drop alone can't honor that. The fallback is
keeping a lightweight row-delete for the shorter-retention minority and only
dropping partitions past the global-max `keep_days`. Needs a product call
before any migration is written.
