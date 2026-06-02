# Phase 5 — Table partitioning plan (7-year retention, scale to 1,000 facilities)

**Status:** plan only — no DDL applied. Partitioning is a heavy, mostly-irreversible
schema change; this document is for review before any migration is written.

## Why

At 1,000 facilities the append-only, time-series tables grow without bound and carry
a **7-year retention** requirement. Two costs bite:

1. **Purge cost.** Today `purge_old_*()` (migration 24) does `DELETE ... WHERE created_at < now() - keep_days` per facility. At volume that's a row-by-row delete + index churn + autovacuum bloat every run. With range partitioning by time, purging a whole expired window becomes `DROP TABLE`/`DETACH PARTITION` — near-instant, no bloat.
2. **Scan/index cost.** Admin views filter `facility_id = current_facility_id() AND created_at` ranges. Native partition pruning lets the planner skip every partition outside the queried window.

## Candidate tables (all keyed on `created_at timestamptz`, all facility-scoped, append-only)

| Table | Retention driver | Notes |
|---|---|---|
| `audit_logs` | fastest growth (triggers on ~20 tables) | biggest win; pure append, no UPDATE |
| `ice_depth_measurements` | per-session fan-out | high row multiplier |
| `refrigeration_change_log` | append-only correction log | + same pattern for the other 5 change logs |
| `air_quality_change_log` | " | |
| `ice_operations_change_log` | " | |
| `ice_depth_change_log` | " | |
| `accident_change_log` | " | |
| `communication_audit_log` | " | |

> The `*_report` / `*_submissions` / `*_readings` tables also grow, but they have FK
> children and are edited (not pure append), so partitioning them is higher-risk —
> **defer those**; start with `audit_logs` + the change logs + `ice_depth_measurements`.

## Recommended scheme

- **RANGE partition on `created_at`**, **monthly** partitions, rolling.
  - 7 years ≈ 84 partitions per table. Well within Postgres limits; pruning stays cheap.
  - Monthly (not yearly) so a retention purge drops ~1/84th at a time and recent-window queries touch 1–2 partitions.
- **Composite PK** must include the partition key: `(id, created_at)` (Postgres requires the partition column in every unique/PK constraint). RLS and FKs are unaffected by this.
- **`pg_partman`** (available on Supabase) to automate partition creation + retention, OR a small `cron`-driven `create_next_partitions()` / `drop_expired_partitions()` pair if we want zero new extensions. Recommendation: `pg_partman` + `pg_cron` — both are first-class on Supabase and remove the hand-rolled purge functions entirely.

## Hard constraints / gotchas (why this needs review, not a blind apply)

1. **You cannot convert a populated table to partitioned in place.** The standard path is:
   create `audit_logs_partitioned` (LIKE + partitioned) → attach monthly partitions →
   `INSERT INTO ... SELECT` (or `ATTACH` the old table as the catch-all "before cutover"
   partition) → swap names in one transaction → re-point FKs/RLS/triggers/grants.
   On production this is a **maintenance-window migration**, even though current row
   counts are tiny (audit_logs ≈ 242 rows today), because the cutover must preserve the
   audit trigger wiring (migrations 41/46/93) and RLS policies exactly.
2. **PK change `id` → `(id, created_at)`** ripples to anything referencing these tables.
   Verified today: **no FK points at `audit_logs` or the change-log tables** (they're leaf
   tables), so this is safe — but re-verify before each table.
3. **RLS** carries over to partitioned parents automatically (policies live on the parent);
   no policy rewrite needed, but the isolation test must add an assertion that a child
   partition can't leak cross-facility.
4. **Retention semantics change.** `purge_old_*` deletes per-`keep_days`-per-facility;
   partition-drop is per-time-window **across all facilities**. Since `keep_days` can
   differ per facility, we either (a) keep row-level delete for facilities with shorter
   retention and only drop partitions older than the **max** keep_days, or (b) standardize
   retention. **This is a product decision** — flagged for you.

## Phased rollout (proposed)

1. **Pilot on `audit_logs`** (no FK children, pure append, highest growth). One migration:
   partitioned twin + monthly partitions + `pg_partman` config + cutover + re-wire triggers.
   Add an `rls_isolation.sql` assertion. Ship alone; verify in prod for a week.
2. **Roll the 6 change-log tables** in one migration (identical shape).
3. **`ice_depth_measurements`** (verify its session FK direction first).
4. **Replace `purge_old_*`** with `pg_partman` retention once all targets are partitioned;
   resolve the per-facility `keep_days` vs whole-partition-drop question (#4 above).

## Decision needed before step 1

- **Per-facility `keep_days` vs whole-partition retention** (gotcha #4). If facilities must
  keep different windows, partition-drop alone can't honor that — we'd keep a lightweight
  row-delete for the shorter-retention minority and only drop partitions past the global max.
