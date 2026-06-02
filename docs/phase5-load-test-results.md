# Phase 5 — Scale load test & EXPLAIN ANALYZE: measured results

**Run:** 2026-06-02, against the production schema on project `bqbdgwlhbhabsibjgwmk`.
**Method:** the entire seed + measurement ran inside a **single transaction that ROLLBACKed**
— no data was committed (verified: 0 leftover rows across `facilities`, `audit_logs`, `users`,
`auth.users`, `employees`, `roles` afterward). We measured the real production indexes, RLS
policies, and SECURITY DEFINER helpers — not a reconstruction.

> Why prod-rollback and not a dev branch: Supabase managed branching came up schema-less
> (the MCP copies migration *history* but doesn't replay SQL without a GitHub branching
> integration), and the sandbox has no outbound DB egress to push migrations over the wire.
> A rolled-back transaction on the already-migrated prod DB was the faithful, zero-residue path.

## Dataset
- **1,000 synthetic facilities** + the 1 real facility = **1,001 tenants**.
- **~400,000 `audit_logs` rows** (1,000/facility) for the raw index test; **~50,000 rows**
  (50/facility) for the RLS test. Timestamps spread across a 2-year window.

## Test 1 — raw per-tenant access (RLS bypassed, as table owner) @ ~400k rows / 1,001 facilities

| Query | Plan top node | Index chosen | Seq scan? | Exec time |
|---|---|---|---|---|
| Latest 50 audit rows for one facility (`where facility_id=? order by created_at desc limit 50`) | Limit | **`idx_audit_logs_facility_created`** | No | **0.78 ms** |
| Count rows for one facility | Aggregate | **`idx_audit_logs_facility_id`** | No | **5.36 ms** |
| Last-30-days for one facility | Index Scan | **`idx_audit_logs_facility_created`** | No | **0.07 ms** |

**Verdict:** the scaling indexes added in migrations `00000000000092_scaling_indexes` and
`00000000000096_facility_scaling_indexes` do their job. Every hot per-tenant pattern resolves
via an index in single-digit milliseconds at 1,001-tenant volume. **No sequential scans.**

## Test 2 — RLS isolation + plan, impersonating an `authenticated` facility admin @ 1,001 facilities

Set `request.jwt.claims.sub` to a seeded focus admin, `SET ROLE authenticated`, then queried
`audit_logs`. The `audit_logs_select` policy is
`is_super_admin() OR (facility_id = current_facility_id() AND current_user_role() IN ('admin','gm','super_admin'))`.

**Isolation — passed cleanly at scale:**
- `foreign_rows_visible` = **0** (rows from other facilities visible to the focus admin)
- `visible_distinct_facilities` = **1** (only the focus facility)
- No sequential scan.

**Performance — a real finding worth acting on:**

| Query shape (under RLS, `authenticated`) | Index chosen | Exec time |
|---|---|---|
| **RLS only**, no explicit filter: `select * from audit_logs order by created_at desc limit 50` | `idx_audit_logs_created_at` | **~131–185 ms** |
| **RLS + explicit** `where facility_id = ?` (same logical result) | `idx_audit_logs_facility_id` | **~4.6 ms** |

When the SQL carries **no explicit `facility_id` predicate**, the planner can't push the
function-based RLS check (`facility_id = current_facility_id()`, a STABLE SECURITY DEFINER call)
into an index condition. It walks the global `created_at` DESC index and applies the facility
match as a post-filter, scanning many *other* tenants' rows to collect 50 of its own — a
needle-in-haystack that **gets worse as total cross-tenant volume grows**. Adding an explicit
`facility_id = <the user's facility>` predicate restores index pruning and is **~40× faster**.

### Recommendation (low-risk, app-layer)
Admin "recent activity" / audit-log queries should **always include an explicit
`.eq('facility_id', facilityId)`** filter rather than relying on RLS alone to scope rows.
RLS still guarantees *correctness* (isolation was perfect above) — but an explicit predicate is
what lets Postgres use `idx_audit_logs_facility_created` and stay fast at scale. Audit the
admin audit-log/report list queries for any that select ordered-by-time with no facility filter.

> Optional DB-side hardening (only if some hot path genuinely can't pass the filter): a partial
> or expression index won't help here because the discriminator is a per-request function value;
> the right lever is the explicit predicate. This also reinforces the partitioning plan
> (`phase5-partitioning-plan.md`): monthly range partitions on `created_at` would additionally
> prune the global-created_at scan path by time window.

### Codebase audit outcome (follow-up)
Audited every `audit_logs` read in `src/` for the missing-facility-predicate pattern:

| Query | Location | Verdict |
|---|---|---|
| Audit-log list (admin) | `src/app/admin/audit-log/page.tsx:108` | **OK** — adds `.eq("facility_id", …)` when facility-scoped; the only unfiltered branch is the super-admin *global* view, where RLS short-circuits via `is_super_admin()` and `order by created_at desc limit 300` is the optimal top-N use of `idx_audit_logs_created_at`. |
| Single audit entry | `src/app/admin/audit-log/page.tsx:207` | **OK** — lookup by PK `id`. |
| Employee detail audit history | `src/app/admin/employees/[id]/page.tsx:75` | **Fixed** — had no facility predicate; a facility admin hitting it triggered the needle-in-haystack. Added `.eq("facility_id", emp.facility_id)` (result-preserving; all of an employee's audit rows are in their own facility). |

## What this does NOT cover
- Only `audit_logs` was volume-tested (highest-growth, pure-append, leaf table). The change-log
  tables share its shape; expect similar results but they were not separately seeded.
- Write/INSERT throughput and connection-pool saturation under concurrent serverless load were
  not load-generated here (see `phase5-supavisor-pooling.md` for the pooling guardrail).
- Functional cross-facility isolation across *all* modules remains covered by
  `supabase/tests/rls_isolation.sql` (CI). This test adds the **at-scale** dimension for audit_logs.
