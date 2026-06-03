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

## Considered & rejected: offload to facility custody

**The idea.** Generate a yearly export file per facility (PDF/CSV), send it to
the facility representative to hold for 7 years, then purge those years from the
DB. Goal: minimize stored data.

**Why rejected as the *system of record*.** It diminishes precisely the
evidentiary value the 7-year retention exists to protect:

- **Chain of custody inverts.** Today the operator controls the record with RLS
  + audit triggers. Handing the only copy to the *subject* of the record makes
  them its custodian. For incident/accident reports especially, "the facility
  can't find their 2026 file" is not a defensible answer to a year-6 injury
  claim or subpoena. Liability/insurance/regulatory regimes generally expect
  the operator to **retain and produce**, not delegate.
- **Tamper evidence evaporates.** A DB row with an audit trail is far more
  defensible than an emailed PDF a rep can lose, edit, or re-create.
- **Queryability dies.** Structured rows → flat file means no cross-facility
  trend analysis, threshold-breach search, refrigeration anomaly detection, or
  ice-depth/air-quality severity history for archived years.
- **Availability becomes N×fragile.** One backed-up DB vs. 1,000 reps each
  reliably keeping a file for 7 years — the latter's fleet-wide failure rate is
  effectively 100%.

**Premise check.** Structured report rows are tiny; 7 years across 1,000
facilities is plausibly low-tens of GB — cents of Postgres storage. The real
pain is purge bloat and scan cost, which partitioning already fixes more
cheaply. Measure before optimizing; the heavy offender is
`ice_depth_measurements` (per-point granularity), not the report tables.

**The version that works (keep custody, flip the offload):**

- **Tiered cold-storage archive, not offload.** Instead of `DROP`ping old
  partitions, `DETACH` and dump them to operator-owned cold object storage
  (Supabase Storage / S3), compressed. Cheap, still ours, still RLS-gated, still
  retrievable. Shrinks the hot DB without surrendering the record.
- **Yearly file as a value-add, not the backstop.** Generating a yearly
  PDF/CSV per facility for *their* convenience is fine — give it to reps freely,
  but keep the authoritative copy. Same generation logic, opposite conclusion
  about who is the system of record.

## The one decision blocking step 1

**Per-facility `keep_days` vs whole-partition retention.** If facilities must
keep different windows, partition-drop alone can't honor that. The fallback is
keeping a lightweight row-delete for the shorter-retention minority and only
dropping partitions past the global-max `keep_days`. Needs a product call
before any migration is written.
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
