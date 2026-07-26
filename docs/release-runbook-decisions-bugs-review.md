# Release runbook — decisions & bugs review (migrations 208–219)

Concrete deploy steps for the `claude/decisions-bugs-review-5y1roa` batch:
migrations **208–219** plus their app changes. Companion to `DEPLOY.md`
(general procedure) and `production-reconciliation-2026-06.md` (history repair).
This runbook is per-release; the reconciliation below is one-time.

## What's in this batch

| Migration | Change | Operational note |
|---|---|---|
| 208 | daily-assignment date windows anchored to facility TZ | function replace; no data change |
| 209 | strip retired `gm`/`supervisor` from policies/functions/seeds | policy + function replace |
| 210 | `audit_row_change()` warns on facility-unresolvable skip | function replace |
| 211 | `scheduling_blocking_violations` + 5 RPCs honor the toggle | function replace; publish result gains `advisory_warnings` |
| 212 | audit retention configurable, **7-year floor** (CHECK + clamp) | adds `retention_settings_audit_floor` CHECK |
| 213 | two-phase audit destruction (quarantine + 2-admin approve) | **2 new tables**, purge now stages instead of deletes |
| 214 | audit log hash-chained + append-only + backfill | adds `seq/prev_hash/row_hash`; **backfills existing rows**; UPDATE/DELETE on `audit_logs` now raise outside the governed bypass |
| 215 | daily-report corrections (supersede, never edit) | adds columns + supersede RPC |
| 216 | gate `user_has_permission`; `check_rate_limit` → service-role only | **app callers already updated** (login + info-requests use the service client) |
| 217 | child-row inserts require submit + parent ownership | 4 INSERT policy replacements |
| 218 | `verify_all_audit_chains()` + `/api/cron/verify-audit-chain` | **new cron** — needs the vercel.json entry (already added) |
| 219 | `audit_logs` monthly range partitioning (pilot) | **maintenance-window cutover** — see §4 |

No new environment variables. `CRON_SECRET` is reused by the new cron.
Generated types (`src/types/database.ts`) and `schema.snapshot.sql` are already
regenerated and CI-guarded — nothing to do by hand.

## 0. Prerequisite — history reconciliation must be current

`deploy-migrations.yml` runs `supabase db push`, which keys on version strings.
Per `DEPLOY.md` §8 and `production-reconciliation-2026-06.md`, the remote history
was recorded under timestamp versions and must be repaired to the repo's
`00000000000NN` numbers **once** before any push. That doc was last verified
2026-06-10 at repo migration 135; the repo is now at 219.

- If `deploy-migrations.yml` has been merged-and-running since June, migrations
  through the last merged number are already on prod under their repo numbers —
  only 208–219 are genuinely pending. Confirm with `supabase migration list
  --linked` (see §1).
- If it was never enabled, run the full reconciliation in `DEPLOY.md` §8 first,
  re-verifying the table against current prod, then continue here.

Do **not** enable/trust the auto-deploy workflow until `supabase migration list
--linked` shows only 208–219 (and any other truly-new files) as pending.

## 1. Verify pending set

```bash
supabase link --project-ref <project-ref>       # once per machine
supabase migration list --linked                # expect: only 208–219 pending
```

If anything below 208 shows pending, stop — the history isn't reconciled; go to
`DEPLOY.md` §8.

## 2. Rehearse on a Supabase preview branch (do NOT go straight to prod)

This batch backfills `audit_logs` (214) and does an irreversible partition
cutover (219). Rehearse on a branch with production-shaped data:

```bash
supabase branches create rehearse-208-219        # or use the dashboard
# point a shell at the branch DB, then:
supabase db push --linked                         # applies 208–219 in order
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
```

Expect the harness to pass. Then spot-check the two heaviest migrations:

```sql
-- 214: every audit row is chained
select count(*) filter (where row_hash is null or seq is null) as unchained
  from audit_logs;                                 -- expect 0
select public.verify_all_audit_chains();           -- expect ok:true, run as service role

-- 219: audit_logs is partitioned and rows are present
select relkind from pg_class where relname = 'audit_logs';   -- expect 'p' (partitioned)
select count(*) from audit_logs;                   -- expect the pre-cutover count
```

Time the branch apply; migration 214's backfill and 219's copy are O(rows) but
audit volume is small today (~hundreds of rows). Note the elapsed time as your
maintenance-window estimate.

## 3. Apply to production

Either merge to `main` (auto-deploy via the reconciled workflow) or run
`supabase db push --linked` from a linked machine during a low-traffic window.
Order is guaranteed by the numeric prefixes.

## 4. Migration 219 (partitioning) — the one to treat carefully

219 converts `audit_logs` from a plain table to a monthly RANGE-partitioned
table via a create-twin → copy → atomic swap, re-attaching the hash-chain and
append-only triggers, the identity sequence, RLS, and grants. Retention is
**unchanged** — the per-facility staged purge (213/214) still runs; partitioning
is for scan pruning and to make a *future* whole-partition-drop retention cheap
(that switch is a separate, deferred product decision: do facilities need
different audit-retention windows?).

- It is a **maintenance-window** migration (brief exclusive lock on `audit_logs`
  during the swap) and is **not cleanly reversible** — the only rollback is PITR.
- Run it in its own release if you want to bake 208–218 first; the prefixes let
  219 apply later independently.
- After apply, immediately run `select public.verify_all_audit_chains();`
  (service role) — a green result confirms the chain survived the cutover.

## 5. Post-deploy smoke

```bash
# audit-chain cron reachable and clean (bearer = CRON_SECRET)
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://<domain>/api/cron/verify-audit-chain            # expect {"ok":true,...}

# retention floor enforced (as an admin, in the app): the audit-log row
# rejects any keep-days below 2555; the "Pending destruction" card appears
# once a purge has staged a batch.
```

Then the standard `DEPLOY.md` §5 checks (auth, other crons, one real
report → notification → PDF → email round-trip).

## 6. Rollback

Schema rollback for this project is PITR (no down-migrations) — see
`DEPLOY.md`. Most of this batch is `create or replace` and additive columns/
tables, low-risk to leave in place. The only migration whose rollback truly
means PITR is **219** (partition cutover); that's the reason for the branch
rehearsal in §2 and the separate-release option in §4.
