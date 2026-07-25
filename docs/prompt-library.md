# RinkReports — Prompt Library

Paste-ready prompts for Claude, each verified against the codebase rather than
against memory of it.

**Verified against commit `e5056b1` on 2026-07-24.**

> **These verdicts decay.** Every "Current state" note below is a snapshot. Before
> reusing a prompt, re-check its cited paths — a prompt that confidently asserts a
> stale premise is worse than no prompt at all, which is the exact failure this
> document exists to prevent.

## How to use this

1. Prepend the **Standing Context Block** to any prompt.
2. Read the prompt's **Status** and **Current state** lines before pasting. Several
   prompts originally described work that is already built, or built *backwards*
   relative to what the prompt asks for — those are flagged.
3. Check **Defects found during verification** first. Three of them are live.

---

## Standing Context Block

Copy this to the top of any application prompt.

```
PROJECT CONTEXT — read before proposing anything.

Repo: KellyJ386/Rink-Reports-5-6
Supabase project ref: bqbdgwlhbhabsibjgwmk
Stack: Next.js 16.2 App Router, React 19.2, Supabase, Vercel, Tailwind v4

Next.js 16 is NOT the Next.js in your training data. Routing, middleware, and
config conventions have shifted. Read node_modules/next/dist/docs/ before writing
routing, middleware, server-component, or config code. Concretely: there is no
middleware.ts — request interception lives in src/proxy.ts, which exports a
proxy() function plus a config.matcher. Tailwind v4 has no tailwind.config.*;
config lives in src/app/globals.css.

Non-negotiable architecture rules:
- API layer is server actions or Route Handlers only. Never tRPC.
- facility_id is always server-injected from the session. Never accept it from
  the client.
- RBAC has FOUR roles: super_admin(0) > admin(1) > manager(2) > staff(3), plus
  per-facility custom roles (e.g. driver). There is no org_admin, no
  facility_manager, and no supervisor — gm and supervisor were retired and are
  now blocked by a CHECK constraint on public.roles. Authorization is resolved
  through the user_permissions matrix and the has_module_access /
  has_module_admin_access helpers, NOT by role tier. Roles only seed permission
  defaults.
- RLS enabled on every table. No exceptions, no service-role shortcuts in
  user-facing paths.
- Offline-first via a hand-rolled service worker (public/sw.js) plus raw
  IndexedDB, replayed through /api/offline-sync into the offline_sync_queue
  table with onConflict: "local_id" for idempotency. There is no Dexie in this
  project — do not introduce it. The client never writes to offline_sync_queue
  directly.
- All configurable values come from the database and are editable in the Admin
  Panel. Never hardcode operation types, equipment types, compressor counts,
  area names, or thresholds.
- Brand tokens: neon lime #4DFF00, navy #002244, Space Grotesk and Space Mono.
  Defined in src/app/globals.css and mirrored in src/lib/tokens.ts. Use the
  utility classes (bg-primary, bg-rr-green); never inline a hex. Both light and
  dark themes are supported — always use the semantic tokens.

Workflow rules:
- I work in the browser. Database work goes through the Supabase MCP; deploys
  through Vercel. Prefer not to give me terminal or local-dev instructions.
  Note that this repo's merge gates ARE terminal-based (pnpm lint, pnpm test,
  the rls_isolation.sql harness, and nine GitHub Actions workflows), so any
  change still has to satisfy them — tell me what CI will check even if you
  don't ask me to run it locally.
- Migrations are a flat, numerically-ordered set in supabase/migrations/, one
  file per prefix. The current head is 00000000000207. Regenerate
  src/types/database.ts in the same change as any migration; CI enforces
  freshness. Never bridge a schema gap with an `as any` cast.

Before writing code: state your plan, list the tables and policies you'll touch,
and flag anything that conflicts with the rules above. Wait for my go-ahead.
```

**Changed from the previous version of this block**, each verified:

| Previously said | Actual | Evidence |
|---|---|---|
| Next.js 15 | **16.2.11** / React 19.2.7 | `package.json`; `AGENTS.md` |
| Dexie.js for offline | No Dexie dependency; hand-rolled SW + IndexedDB | `public/sw.js`, `src/lib/offline/` |
| Five tiers incl. `org_admin`, `facility_manager`, `supervisor` | Four roles; `org_admin` appears **zero** times repo-wide; `gm`/`supervisor` CHECK-blocked | `supabase/migrations/00000000000188_fix_facility_role_seeding.sql` |
| "Publish-lock is UI-only (critical defect)" | Fixed at the DB boundary for `schedule_shifts` | migrations `148`, `164`, `181` |
| "Never give me terminal instructions" | Kept as a preference, with the CI caveat added | `.github/workflows/` |

> **On the word "supervisor".** It appears a few times below as ordinary English
> — "a rink supervisor", "a supervisor tool" — meaning a person's job, not a role
> key. As a *role*, `supervisor` was retired and is CHECK-blocked. Never write it
> into a permission check, a policy, or a seed.

---

## Defects found during verification

Not part of the original library — these surfaced while checking its claims.

### Legend

**VERIFIED** — confirmed by direct inspection.
**UNCONFIRMED — confirm first** — reported by an automated audit pass, not
independently verified. Do not act on these as fact until checked.

---

### Defect 1 — Retention can be driven to destroy compliance records — **VERIFIED → CLOSED (migration 208)**

> **Closed by `supabase/migrations/00000000000208_retention_floors_and_keep_forever.sql`.**
> Per-module floors now live in `retention_module_floors` and are enforced by a
> BEFORE INSERT/UPDATE trigger on `retention_settings`, so the floor is applied at
> the database boundary rather than in the browser. `keep_days = 0` ("keep
> forever") is now permitted and forces `auto_purge = false`, which is what makes
> it safe: every retention-driven purge function filters `auto_purge = true`, so a
> keep-forever row can never be selected by one. Existing rows below their floor
> were raised up to it. Regression assertions are in `supabase/tests/rls_isolation.sql`
> (section 2z, `RETENTION-208`). **Still open** from the original I-4 ask: legal
> hold, flag-for-review instead of hard delete, and retention-aware DELETE guards
> on compliance tables.
>
> Two claims in the original write-up below were **wrong**, corrected here:
> `purge_module_data` *does* already guard `keep_days = 0` and *does* authorize via
> `is_super_admin() or is_facility_admin()`; and `audit_logs` was never
> retention-configurable — migration 24 pins it to a fixed 7-year window, so the
> retention UI was advertising a setting nothing read. Both `audit_logs` and
> `scheduling` have been removed from the retention UI for that reason.

The retention engine exists, but implements close to the **inverse** of what I-4
asks for.

- I-4 wants *"records inside their retention window cannot be deleted by any role,
  enforced at RLS."* **No RLS policy anywhere consults `retention_settings`.**
  Retention is advisory to a nightly cron and nothing else.
- I-4 wants *"flagged for review, never auto-deleted."* The cron runs unconditional
  `delete from …` RPCs as service-role
  (`supabase/migrations/00000000000024_retention_aware_purge_functions.sql`,
  `src/app/api/cron/run-retention-purge/route.ts`). No soft delete, no review queue.
- **The live hole:** the per-module minimum (365 days for accident/incident
  reports) exists **only in the UI**, passed as a `minDays` prop
  (`src/app/admin/retention/_components/retention-row.tsx`). The server action
  enforces a flat `keepDays === 0 || keepDays >= 30` for *every* module
  (`src/app/admin/retention/actions.ts`). A crafted POST sets accident retention to
  30 days, and the cron then permanently deletes accident reports at 30 days,
  nightly.
- **`legal_hold` does not exist** anywhere in `src/` or `supabase/`.
- **"Forever" is broken, and the schema contradicts itself.**
  `supabase/migrations/00000000000018_retention_settings.sql` line 15 declares
  `check (keep_days >= 30)`; line 19's comment on the same table says
  *"keep_days=0 means keep forever (disabled)"*. The server action accepts `0`.
  Saving Forever therefore fails on a constraint violation. No later migration
  alters the constraint.
- `scheduling` is offered in the retention UI, but `purge_module_data` raises
  *"Manual purge is not supported for scheduling"*
  (`supabase/migrations/00000000000132_purge_module_data.sql`) — a settable,
  permanently inert row.

### Defect 2 — Submitted compliance records are mutable in place — **VERIFIED, but downgraded**

> **CORRECTION (2026-07-24, same day).** This entry originally claimed that a
> direct `UPDATE` on an accident report "writes **no change-log row at all**".
> **That was wrong**, and the error mattered: it drove the sequencing that put I-3
> ahead of I-2.
>
> `public.audit_row_change()` — a SECURITY DEFINER AFTER trigger capturing full
> `before`/`after` JSONB plus actor and entity id — **is** attached to both
> `accident_reports` and `incident_reports`
> (`supabase/migrations/00000000000041_audit_triggers.sql:137-146`), and migration
> 46 extends it to `air_quality_reports`, `refrigeration_reports`,
> `ice_depth_sessions`, `daily_report_submissions` and `ice_operation_reports`.
> Every mutation of those tables therefore **does** land in `audit_logs`, by
> whatever path it arrives.
>
> What is genuinely missing is narrower: the **module-specific**
> `accident_change_log` row, which is what the admin History tab renders. A
> record edited outside the app therefore shows complete history in the audit log
> but an incomplete one in its own module view. That is a real inconsistency, not
> an integrity hole — and I-2's hash chaining is **not** undermined the way this
> entry originally claimed, because the chain covers `audit_logs`, which is
> trigger-populated rather than app-populated.

I-3 assumes *"once submitted, the original values are immutable."* Not true today.

- `edit_window_ends_at` defaults to `now() + interval '24 hours'` on
  `accident_reports` and `incident_reports`
  (`supabase/migrations/00000000000010_accident_reports_schema.sql`). Submitters
  edit **destructively in place** inside that window, and it is enforced in RLS —
  not merely a UI affordance.
- Outside the window the policy is *"UPDATE: super_admin OR module admin OR (own
  row AND now() <= edit_window_ends_at)"* — so **an admin may update an accident
  report at any time, indefinitely**.
- `accident_change_log` has **no trigger**. It is written only from application
  code (`src/app/reports/accidents/_lib/submit.ts`,
  `src/app/reports/accidents/actions.ts`). The migration's own comment concedes
  changes *"should be logged in accident_change_log by the app."*

Net effect (as corrected above): a direct PostgREST `UPDATE` from an admin session
mutates a compliance record, is **fully captured in `audit_logs`** by the generic
trigger, but produces **no `accident_change_log` row** — so the module's own
History tab silently under-reports. The remaining substance of I-3 is therefore
about **immutability and amendment semantics**, not about tracing: records should
not be destructively editable at all, and corrections should be new linked
versions with a reason. That is feature work, not an urgent hole.

Prior art for the fix: `superseded_at` on `report_area_assignments`
(`supabase/migrations/00000000000182_daily_area_assignment_schema.sql`).

### Defect 3 — Certification expiry is checked against today, not the shift date — **VERIFIED → CLOSED (migration 209)**

> **Closed by `supabase/migrations/00000000000209_cert_expiry_vs_shift_date.sql`.**
> The predicate now keys off `v_end_local::date` — the facility-local **end** of
> the shift — so a certification must remain valid for the whole shift, and one
> lapsing mid-shift blocks the assignment. That end-of-shift boundary is a
> deliberate decision recorded in the migration header. One line; the signature
> was unchanged, so none of the six SQL callers or the single TypeScript caller
> needed touching.
>
> **The pre-existing test was a false positive worth remembering.** §2Q already
> asserted *"EXPIRED required cert is treated as missing"* — but it seeded
> `expires_at = '2020-01-01'`, which precedes every future shift date, so it
> passed identically with and without the bug. Three `SCHED-209` assertions
> replace that illusion: a cert expiring before the shift blocks, one still valid
> does not, and one lapsing mid-shift blocks. All three were confirmed to FAIL
> against the pre-209 schema before the fix was applied.

`supabase/migrations/00000000000169_certification_types.sql` validates with
`and (c.expires_at is null or c.expires_at >= current_date)`. A shift three weeks
out validates against a certification expiring next week, and publish-time
re-validation uses the same `current_date`. Nothing ever compares expiry to the
shift's `starts_at`.

### Defect 4 — Publish-lock siblings are unprotected — **VERIFIED (A, B) → CLOSED (migration 210); C REFUTED**

> **Closed by `supabase/migrations/00000000000210_open_shift_and_swap_guards.sql`.**
> Two guard triggers, cloning the exemption model of
> `schedule_shifts_publish_lock` so all six SECURITY DEFINER scheduling RPCs pass
> through untouched. No application change was needed. All five exploits were
> **reproduced live** against the pre-210 schema before the guards were written —
> see `SCHED-210` in `supabase/tests/rls_isolation.sql`.

`schedule_shifts` itself is solid; its two satellite tables were not.

**A — `schedule_open_shifts`: CONFIRMED, but narrower than first claimed.** Its
RLS comes from migration 15 (loosened by 61), gating UPDATE/DELETE only on
`has_module_admin_access('scheduling')` with no column restriction and no publish
predicate. The one trigger was `set_updated_at`; the only CHECK enumerated legal
`claim_status` *values*, not transitions.

The original wording said an admin could bypass re-validation to *assign* someone.
**That was wrong** — the parent shift stays frozen by the publish lock, so no
assignment is possible this way. The real exposures were:

- **Approval-gate bypass, the one that mattered.** `UPDATE … SET approval_required
  = false` turned a manager-approval listing into first-come, and
  `scheduling_claim_open_shift` branches purely on that column — so the next staff
  claim auto-filled a published shift that policy required a human to approve.
  Violations were still checked; the *approval step* vanished.
- **Silent staffing desync** via `claim_status = 'filled'` — queue reads staffed,
  shift stays unassigned, and both the staff queue and admin panel read the queue.
- **Listing deletion / `expires_at` tampering** past the expiry sweeper.

**B — `schedule_swap_requests`: CONFIRMED, impact is bricking.** The admin branch
of the UPDATE policy was an unqualified `has_module_admin_access('scheduling')` on
both `USING` and `WITH CHECK`, so `'manager_approved'` was one PATCH away. It moved
no shift — but the divergence was **one-way and unrecoverable**:
`scheduling_apply_swap` then refuses (`status not in ('pending','accepted')`), and
`denySwap`/`cancelSwap` both refuse on `manager_approved`. The request sat reading
"Approved & applied" while nothing had happened and neither employee was notified.

**C — republish weaker than publish: REFUTED as framed.**
`scheduling_admin_edit_published_shift` does filter to `cert_missing:%`, but that
is **consistent** with the rest of the system rather than weaker: the app layer
deliberately treats non-cert codes as advisory (`partitionViolations`), the edit
still runs the full `gateShiftWrite` before calling the RPC, and `double_booked`
has its own DB backstop (migration 140). The actual outlier is
`scheduling_approve_publish_request`, which is *stricter* than the app's stated
policy.

Two smaller residual gaps remain, deliberately **not** fixed: that RPC ignores
`schedule_settings.block_on_violations` (so a direct RPC call skips hard-blocking
at a facility that opted in), and it discards advisory codes instead of returning
them. Closing these means choosing a direction — make 149 honour
`block_on_violations`, or make `approve_publish_request` cert-only so
`block_on_violations` is the single knob across all five paths. That is a product
decision, not a defect fix.

### Defect 5 — Air-quality rules are parsed but not enforced — **UNCONFIRMED — confirm first**

The Massachusetts `sampling_rules` row is populated
(`supabase/migrations/00000000000146_air_quality_compliance_profiles.sql`) with
`min_per_week`, `min_weekday`, `min_weekend`, and `post_resurfacing_minutes`. But:

- `post_resurfacing_minutes` is reportedly parsed and then **never read again** —
  the 20-minute post-resurface requirement is inert.
- The 4-hour/1-hour end-of-day sampling window is **absent from the ruleset
  entirely**.
- `facility_air_quality_config.frequency_config` is selected in
  `src/app/reports/air-quality/_lib/load-compliance.ts` and never used.
- "Tighten but never loosen" is enforced in the server action only
  (`src/app/reports/air-quality/_lib/compliance.ts`); there is reportedly no DB
  constraint on `threshold_overrides`, so a direct PostgREST update could write a
  loosened ceiling.

### Defect 6 — App-level audit writes fail silently — **VERIFIED (scope narrowed)**

`src/lib/audit/log.ts` wraps its insert in `try { … } catch { }` with the comment
*"Auditing is best-effort. Don't surface the failure."* So a `logAudit()` write can
vanish with no signal.

**Scope is narrower than first stated.** This affects only *app-level* calls to
`logAudit()`. The trigger-written rows — which is how every compliance table is
audited (`audit_row_change()`, see the Defect 2 correction) — insert inline in the
same transaction as the change, so they either commit with it or fail it. There is
no silent-loss path there. I-2's chain substrate is therefore sound; surfacing
`logAudit()` failures is a smaller, separate concern.

### Defect 7 — Three harness assertions are time-of-day flaky — **VERIFIED**

Found while running the suite for migration 209, not part of the original review.

`DAR`, `DAR5` and `DAR7` in `supabase/tests/rls_isolation.sql` assert against
`current_date - 1`, which psql evaluates in **UTC**, while the gate they exercise
computes "today" in the **facility-local** timezone
(`supabase/migrations/00000000000183_daily_area_assignment_rls.sql:151`). Between
UTC midnight and facility midnight, "yesterday UTC" is still *today* locally, so
the insert the test expects to be rejected legitimately succeeds.

The relevant facility is **A**, which never sets a timezone in the fixtures and so
inherits the `facilities.timezone` default of `'America/New_York'`
(`supabase/migrations/00000000000002_backbone_schema.sql:36`). The bad window is
therefore roughly **00:00–04:00 UTC** in summer — about **4 hours in every 24**.
*(An earlier revision of this entry said ~5 hours from `America/Chicago`; that is
the unrelated Seed Test Rink fixture, not the facility these tests use.)*

Observed across three runs on unchanged code — 23:38 UTC: 1 failure · 00:18 UTC:
4 failures · 12:08 UTC: 1 failure. Same schema, same assertions, different clock.
Also confirmed pre-existing by stashing all local changes and re-running.

**Scope is larger than the three failing assertions.** The harness has 54 real
`current_date` uses; `:1184` and `:1194` feed `business_date` into the same
facility-local gate and are latently flaky too — they simply have not been caught
by the clock yet. A correct fix is a `pg_temp` facility-local-today helper plus a
judged pass over the DAR block (≈3931–4721) deciding per site whether it should be
UTC or facility-local. Not attempted here.

---

## Status legend

- **BUILT** — the prompt's premise is stale; the work is done.
- **PARTIAL** — a foundation exists; the prompt should extend it, not start over.
- **OPEN** — a genuine gap; the prompt stands as written.

---

# PART 1 — IMMEDIATE

### I-1. Publish-lock server-side enforcement

**Status:** PARTIAL — `schedule_shifts` is fully locked. The gap moved to sibling tables. See Defect 4.

**Current state (verified 2026-07-24):** The bypass this prompt was written to fix
is closed. Migrations `148`, `164`, and `181` install a
`before insert or update or delete` trigger on `schedule_shifts` that rejects
mutation of a published row, insertion of a row as published, and the
draft→published transition, for any end-user role. Migration 181's header
documents the exact bug and its app-layer fix (removing `status` from
`updateGridShift`). Publishing now runs exclusively through a two-person
publish-request RPC that rejects self-approval. `supabase/schema.snapshot.sql`
matches, so production has the latest trigger.

```
Extend publish-lock enforcement from schedule_shifts to its sibling tables.

Current state: schedule_shifts is fully locked at the DB boundary by the trigger
installed across migrations 148/164/181 — published rows cannot be updated or
deleted, a row cannot be inserted as published, and the draft->published
transition is rejected for end-user roles. That part is done. Do not redo it.

The remaining exposure is in adjacent tables that can mutate the meaning of a
published schedule without touching schedule_shifts:

1. Inventory every table that participates in a published schedule —
   schedule_open_shifts, schedule_swap_requests, schedule_assignment_overrides,
   schedule_publish_requests, and anything else you find. Give me the full list
   with its current RLS policies before changing anything.
2. For each, show me whether publish state is consulted, and where.
3. Specifically verify: can a scheduling admin flip claim_status,
   claimed_by_employee_id, approval_required, or expires_at on an open shift
   belonging to a PUBLISHED schedule via a direct PostgREST write, bypassing
   scheduling_decide_open_claim? Can they set schedule_swap_requests.status to
   approved without scheduling_apply_swap running its re-validation, leaving swap
   state and shift state divergent?
4. Check scheduling_admin_edit_published_shift: confirm whether it blocks on the
   full violation set or only on cert_missing codes. If it discards overtime,
   rest, time-off, or not-qualified violations, the governed republish path is
   weaker than the publish path — fix that.
5. Confirm the service_role exemption cannot be reached from a user-facing path.
   Note that governance-actions.ts already uses createAdminClient() for
   schedule_open_shifts.
6. Extend supabase/tests/rls_isolation.sql with an assertion per bypass found.

Show me the RLS policy SQL before applying it.
```

*Corrections applied:* the premise "lock enforcement lives only in the UI" was
removed — it is false as of migration 181. Reframed as extending the existing lock.

---

### I-2. Append-only audit trail with hash chaining

**Status:** PARTIAL — append-only table exists; tamper-evidence does not.

**Current state (verified 2026-07-24):** `audit_logs`
(`supabase/migrations/00000000000002_backbone_schema.sql`) already records
facility, actor, action, entity, before/after JSON, IP, and user agent, with RLS
permitting only SELECT and INSERT
(`supabase/migrations/00000000000004_backbone_rls.sql`). Triggers exist
(`supabase/migrations/00000000000041_audit_triggers.sql`,
`supabase/migrations/00000000000046_audit_triggers_expansion.sql`) and there is a
filterable admin UI at `src/app/admin/audit-log/`. There is **no hash chaining** —
no `prev_hash`, `record_hash`, checksum, digest, or signature column anywhere. Note
that `supabase/migrations/00000000000138_ice_depth_integrity_and_purge.sql` is a
false lead: its "integrity" means CHECK constraints, not tamper evidence.

```
Add tamper-evidence to the existing audit trail. Do not rebuild it.

Current state: public.audit_logs already exists with facility_id, actor_user_id,
actor_employee_id, action, entity_type, entity_id, before, after, ip, user_agent,
created_at, and RLS that permits only SELECT and INSERT. Triggers populate it
(migrations 41 and 46) and there is an admin viewer at src/app/admin/audit-log/.
What is missing is proof that the log has not been altered — and proof that it
has not been silently skipped.

Do this:
1. FIRST, fix silent loss. src/lib/audit/log.ts is a best-effort insert wrapped
   in a try/catch that swallows failures. A hash chain over a log that can drop
   rows detects alteration but not omission, which is the weaker half of the
   guarantee. Decide with me whether a failed audit write should fail the
   originating transaction or raise an operational alert, then implement it.
2. Add hash chaining: each entry stores a hash of its own contents plus the
   previous entry's hash, scoped per facility. Show me how you will make the
   chain deterministic given jsonb column ordering.
3. Provide a verification function that walks the chain and reports the first
   break, and expose its result in the admin viewer.
4. Confirm no UPDATE or DELETE is possible by any role, enforced by RLS rather
   than convention — including service_role paths reachable from a user request.
5. Offline writes must queue and enter the chain in server-received order on
   sync, with the original client capture time preserved as a separate field.
   The queue is the service worker + offline_sync_queue, not Dexie.
6. Extend the audit viewer with module / date-range / user filters restricted to
   admin and above, and add chain-verification assertions to
   supabase/tests/rls_isolation.sql.

Start with the schema and RLS policies. Show me the SQL before applying.
```

*Corrections applied:* reframed from "design and implement an audit trail" to
extending the existing one; added the silent-write-failure requirement (Defect 6);
removed the `facility_manager` role reference.

---

### I-3. Correction workflow — no destructive edits

**Status:** PARTIAL — and the prompt's premise is false today. See Defect 2. **Do this early.**

**Current state (verified 2026-07-24):** Compliance records are **not** immutable.
`accident_reports` and `incident_reports` carry `edit_window_ends_at` defaulting to
24 hours, within which the submitter edits destructively in place — enforced in
RLS. Outside that window, module admins may still update the row indefinitely. And
`accident_change_log` has no trigger; it is written only from
`src/app/reports/accidents/_lib/submit.ts` and
`src/app/reports/accidents/actions.ts`, so a direct PostgREST update leaves no
trace at all. Daily reports *are* append-only
(`supabase/migrations/00000000000161_daily_report_append_only.sql`), and per-module
change logs exist for refrigeration and ice depth
(`supabase/migrations/00000000000032_refrigeration_change_log.sql` and siblings).

```
Replace destructive editing on submitted compliance records with a correction
workflow, modeled on how clinical and laboratory records handle amendments.

IMPORTANT — the current state is not what you may assume. Submitted records are
NOT immutable today:
- accident_reports and incident_reports have edit_window_ends_at (default 24h);
  the submitter edits DESTRUCTIVELY IN PLACE within it, enforced in RLS.
- Outside that window, the UPDATE policy still permits super_admin OR module
  admin — indefinitely.
- accident_change_log has NO trigger. It is written only by application code, so
  a direct PostgREST UPDATE mutates the record and logs nothing.

Work in this order:
1. Close the hole first. Move change-logging into a database trigger so no write
   path can mutate a compliance record without producing a log row. Then tighten
   the UPDATE policy so that post-submission mutation is not possible for any
   role — corrections must go through the workflow below, not through UPDATE.
   Show me the policy SQL before applying it.
2. Then build the workflow:
   - A correction creates a new linked version with: reason code (from an
     admin-configurable list), free-text justification, correcting user, and
     timestamp.
   - Corrections above a configurable materiality threshold require manager or
     admin approval before taking effect.
   - All views and PDF exports display the current value with a visible
     correction indicator; the original and full correction history are viewable
     on click and included in regulator exports.
   - Apply to Air Quality, Refrigeration, Ice Depth, Incident, and Accident
     records.
3. Reuse the existing supersede pattern rather than inventing one: superseded_at
   on report_area_assignments (migration 182) is the closest prior art in this
   repo. Reuse the per-module _change_log tables (migrations 32-35) rather than
   adding parallel history tables.
4. Check whether the other _change_log tables share accident_change_log's
   trigger-less pattern, and fix any that do.

Enforce at the RLS and trigger layer, not the UI. Every correction and approval
writes to the audit chain.
```

*Corrections applied:* the assertion "once a record is submitted, the original
values are immutable" was replaced with the verified current state, and a
close-the-hole step was added ahead of the workflow. `supervisor` →
`manager or admin`.

---

### I-4. Retention policy engine

**Status:** PARTIALLY DONE — the data-loss path was closed by migration 208 (see Defect 1). Legal hold, flag-for-review, and RLS delete guards remain open.

**Current state (verified 2026-07-24):** `retention_settings`
(`supabase/migrations/00000000000018_retention_settings.sql`) is per-facility,
per-module, with `keep_days` and `auto_purge`; there are per-module purge functions
(`supabase/migrations/00000000000024_retention_aware_purge_functions.sql`), a
nightly cron (`src/app/api/cron/run-retention-purge/route.ts`, scheduled in
`vercel.json`), and an admin UI (`src/app/admin/retention/`). But retention is
advisory to the cron — no RLS policy consults it — the purge is an unconditional
hard `DELETE`, the per-module minimum is UI-only, `legal_hold` does not exist, and
the "keep forever" value the table comment documents is forbidden by the table's
own CHECK constraint.

```
Fix the records retention engine. It exists, but it currently does close to the
opposite of what is required — read this before proposing anything.

Verified current state:
- No RLS policy anywhere consults retention_settings. Retention is advisory to a
  nightly cron and nothing else. An in-window record is deletable by anyone with
  ordinary delete rights.
- The nightly cron (src/app/api/cron/run-retention-purge/route.ts) runs
  unconditional `delete from ...` RPCs as service-role. There is no soft delete
  and no review queue.
- The per-module minimum (365 days for accident/incident reports) is enforced
  ONLY in the UI, as a minDays prop in
  src/app/admin/retention/_components/retention-row.tsx. The server action
  (src/app/admin/retention/actions.ts) accepts a flat keepDays >= 30 for EVERY
  module. A crafted POST therefore sets accident retention to 30 days and the
  cron permanently deletes accident reports at 30 days, nightly. Treat this as
  the priority fix.
- legal_hold does not exist anywhere.
- migration 18 declares `check (keep_days >= 30)` while the same table's comment
  says "keep_days=0 means keep forever (disabled)", and the server action accepts
  0. Saving "Forever" fails on a constraint violation.
- The retention UI offers `scheduling`, but purge_module_data raises "Manual
  purge is not supported for scheduling" (migration 132) — a settable, inert row.

Do this, in order:
1. Move per-module retention minimums server-side, sourced from the database
   rather than a UI prop, and reject any write below the module's floor.
2. Resolve the keep_days=0 contradiction — either permit 0 and make the purge
   functions skip it (they currently have no keep_days > 0 guard, so relaxing
   the constraint without one would delete every row in the module), or remove
   "Forever" from the UI. Tell me which you recommend and why.
3. Replace unconditional auto-delete with flag-for-review. Records past
   retention are marked, never silently removed. Purge requires an explicit
   admin action and writes to the audit chain.
4. Enforce at RLS: a record inside its retention window, or under legal hold,
   cannot be deleted by any role.
5. Add the legal-hold flag — a record or date range set indefinitely
   non-deletable regardless of retention period, settable by admin and above.
6. Either implement scheduling retention or remove it from the UI. Do not leave
   a setting that silently does nothing.
7. Report which modules have no retention coverage at all — dasher boards,
   facility documents, employee certifications, and PDF attachments are
   candidates.

Show me the schema and policies first.
```

*Corrections applied:* rewritten from "build an admin-configurable retention
engine" to a defect-driven fix list, since the engine exists. `org_admin` → `admin`;
`facility_manager` → `admin`.

---

### I-5. SECURITY DEFINER and privilege audit

**Status:** OPEN — stands as written. Defects 1, 2, 4, and 5 are all instances of exactly what it hunts.

**Current state (verified 2026-07-24):** There is real prior art to build on rather
than duplicate: `supabase/tests/rls_isolation.sql` is a CI-run cross-facility
isolation harness, `docs/security-audit-exceptions.md` tracks dependency
advisories, and `.github/workflows/security-scan.yml` gates on them. No
comprehensive SECURITY DEFINER inventory exists.

```
Re-run a full privilege audit on the Supabase project and give me a findings
table.

Prior art to build on, not duplicate: supabase/tests/rls_isolation.sql is an
existing CI-run cross-facility isolation harness; docs/security-audit-exceptions.md
tracks accepted dependency advisories. There are 207 migrations.

Cover:
- Every SECURITY DEFINER function: what it does, what it can reach, whether it
  validates the caller's role and facility_id, and whether it can be invoked to
  cross facility boundaries.
- Every table: RLS enabled yes/no, and whether the policies actually restrict by
  facility_id and permission rather than just checking authentication.
- Any use of the service role key in a path reachable from a user request.
- Any view or materialized view that bypasses RLS on its underlying tables.
- Storage bucket policies, especially Incident Report photo uploads and facility
  documents.
- This specific pattern, which has already produced four findings: a constraint
  enforced in the UI or in application code but NOT at the database boundary.
  Check every _change_log table for the trigger-less pattern found in
  accident_change_log, and every admin settings form for a server action whose
  validation is weaker than its UI's.

Format as a table with: object, risk, severity (critical/high/medium/low), and
recommended fix. Do not change anything yet — I want the findings first.
```

*Corrections applied:* added the prior-art pointers and the UI-stronger-than-server
pattern, which has already produced Defects 1 and 2.

---

### I-6. SSO / SAML

**Status:** OPEN — confirmed absent.

**Current state (verified 2026-07-24):** Authentication is Supabase email/password
plus magic-link invite only — `src/app/(auth)/login/actions.ts` uses
`signInWithPassword`, `src/app/(auth)/callback/route.ts` uses `verifyOtp`. There is
no `signInWithSSO` or `signInWithOAuth` anywhere, no IdP dependency in
`package.json`, and no IdP variables in `.env.example`.

```
Add SSO to RinkReports. Without it we fail university and municipal procurement
regardless of features.

Current state: auth is Supabase email/password (src/app/(auth)/login/actions.ts,
signInWithPassword) plus magic-link invite (src/app/(auth)/callback/route.ts,
verifyOtp). No IdP dependency, no IdP env vars. This is genuinely greenfield.

Requirements:
- SAML 2.0 and OIDC via Supabase Auth. Must work with Okta, Microsoft Entra ID,
  and Google Workspace.
- Per-organization IdP configuration, managed in the Admin Panel by super_admin
  (note: there is no org_admin role in this system — the roles are super_admin,
  admin, manager, staff, plus per-facility custom roles).
- Attribute mapping from IdP claims to the permission model. Map claims to
  user_permissions entries, not to a role tier — roles only seed defaults here.
  Provide a configurable default for unmapped users and an admin approval queue
  for first-time logins.
- Optional enforcement: an organization can require SSO and disable password
  login for its users.
- Just-in-time provisioning, with facility assignment either from an IdP claim
  or from the approval queue.
- SSO users must still be subject to identical RLS and facility_id scoping.
  Prove this by extending supabase/tests/rls_isolation.sql, don't assume it.

Give me the auth flow diagram and the schema changes first.
```

*Corrections applied:* `org_admin` → `super_admin` with an explicit note; role-tier
mapping → permission-matrix mapping; the "run the publish-lock regression probe"
tail was replaced with extending the RLS harness, which is the real gate.

---

### I-7. Accessibility audit toward WCAG 2.1 AA / VPAT

**Status:** PARTIAL — real groundwork exists; no audit, no VPAT.

**Current state (verified 2026-07-24):** A skip link exists at
`src/app/layout.tsx`. There are roughly 271 `aria-*` / `role=` / `sr-only` usages
across ~110 files — dense in the body diagram and incident form, thin in admin
tables. `src/lib/color-contrast.ts` provides a WCAG relative-luminance helper, and
`readableForeground()` selects near-black text on light fills such as lime.
`src/app/globals.css` asserts *"All body/surface combos hit WCAG 2.2 AA"* with
specific ratios annotated — **but that is a code comment, not a test**. There is no
axe integration, no a11y test suite, and no VPAT document.

```
Audit RinkReports against WCAG 2.1 Level AA and produce a remediation plan.
Public universities and many state contracts require a VPAT, and this is a silent
deal-killer.

Cover every module plus the Admin Panel. For each finding give me: the success
criterion, the component, severity, and the fix.

Start from what exists rather than assuming:
- src/app/globals.css claims "All body/surface combos hit WCAG 2.2 AA" and
  annotates specific ratios (e.g. 4.9:1 for --foreground-subtle). That claim is a
  comment, not a test. VERIFY it computationally across every token pair in both
  the light and dark blocks and tell me where it actually fails — do not assume
  either that it holds or that it fails.
- Note that #4DFF00 is used as a FILL with automatically-selected dark text via
  readableForeground() in src/lib/color-contrast.ts, not as text on white. Audit
  its real usage before proposing token changes.
- A skip link already exists in src/app/layout.tsx.
- aria/role/sr-only coverage is roughly 271 usages across 110 files but is
  uneven — dense in the body diagram and incident form, thin in admin tables.
  Prioritize by that gap.

Pay particular attention to:
- Keyboard operability of the ice depth diagram, the incident body diagram, the
  dasher-boards perimeter map, and the scheduling grid — the highest-risk
  interactive components.
- Screen reader labeling on all form inputs, especially the Daily Report tab
  structure.
- Focus visibility and focus order.
- Offline sync status announcements to assistive technology.

Recommend how to make this permanent — an axe pass in the existing Playwright
e2e suite is the obvious candidate.

Prioritize into: blocks a VPAT, degrades a VPAT, cosmetic. Start with the audit
only.
```

*Corrections applied:* "our neon lime is very likely failing" was replaced with an
instruction to verify, since lime is used as a fill with auto-selected dark text and
the palette carries an explicit (though untested) AA claim.

---

### I-8. Regression probe suite

**Status:** PARTIAL — probes exist in CI, not in-app.

**Current state (verified 2026-07-24):** `supabase/tests/rls_isolation.sql` is a
transactional, self-rolling-back harness run by
`.github/workflows/rls-isolation.yml`;
`.github/workflows/post-deploy-smoke.yml` asserts health and cron-auth after
production deploys; `src/app/api/health/route.ts` offers two-tier disclosure. There
is no in-app diagnostics console.

```
Build a regression probe suite. Extend what exists rather than starting over.

Current state: supabase/tests/rls_isolation.sql is a transactional harness that
ROLLBACKs at the end and raises on failure, run by
.github/workflows/rls-isolation.yml on migration-touching PRs.
.github/workflows/post-deploy-smoke.yml verifies /api/health and cron auth after
deploy. There is no in-app diagnostics page.

First, tell me which of these belong in the SQL harness (cheap, already wired to
CI) versus an admin-only in-app page (visible to a non-technical operator before
a deploy). I suspect most belong in the harness. Then implement.

It must attempt, and expect rejection of:
1. A write to a locked Employee Scheduling record via every known write path —
   including schedule_open_shifts and schedule_swap_requests, not just
   schedule_shifts.
2. A write with a client-supplied facility_id that differs from the session's.
3. A cross-facility read from each role (super_admin, admin, manager, staff, and
   a custom facility role).
4. An UPDATE or DELETE against the audit trail table.
5. A DELETE of a record inside its retention window, and a DELETE of a record
   under legal hold.
6. A retention_settings write below the module's server-side minimum — the
   accident-report 30-day bypass specifically.
7. An UPDATE of a submitted accident or incident report that does not produce a
   change-log row.
8. A privilege escalation attempt via each SECURITY DEFINER function.
9. A staff-role write to any admin-only configuration table.
10. An air-quality threshold override that loosens a value below the
    jurisdictional floor.

Output a pass/fail table with the response each path returned. Any in-app
surface is super_admin only. This suite is the gate on every future write path.
```

*Corrections applied:* reframed to extend the existing harness; cases 6, 7, and 10
added to lock in Defects 1, 2, and 5; role list corrected to the four real roles.

---

# PART 2 — NICE TO HAVE

### N-1. Massachusetts sampling rule engine

**Status:** PARTIAL — the engine and the Massachusetts ruleset already exist. See Defect 5.

**Current state (verified 2026-07-24):**
`supabase/migrations/00000000000146_air_quality_compliance_profiles.sql` creates
`air_quality_compliance_profiles` with `metrics`, `tiers`, `sampling_rules`,
`escalation_rules`, `method` (single vs 1-hr TWA) and `is_binding`, and seeds
**Minnesota Rule 4620, Massachusetts 105 CMR 675, Wisconsin DHS P-00067, and USIRA
guidance**. Per-facility binding is in
`supabase/migrations/00000000000147_facility_air_quality_config.sql`. The engine
lives in `src/app/reports/air-quality/_lib/`. The MA row's `sampling_rules` is
populated with `min_per_week: 3`, `min_weekday: 2`, `min_weekend: 1`,
`post_resurfacing_minutes: 20`.

```
Finish the Air Quality jurisdiction rule engine. Most of it already exists —
read this before proposing anything.

Current state: air_quality_compliance_profiles (migration 146) already stores
metrics, tiers, sampling_rules, escalation_rules, method (single vs 1-hr TWA) and
is_binding, and already seeds Minnesota Rule 4620, Massachusetts 105 CMR 675,
Wisconsin DHS P-00067, and USIRA guidance. Per-facility binding is in migration
147. The evaluation code is in src/app/reports/air-quality/_lib/. Do NOT rebuild
this.

The Massachusetts rules, for reference:
- CO and NO2 samples at least three times per week, including at least twice on
  weekdays and at least once during weekend operations
- Every sample taken 20 minutes after resurfacing is completed
- Every sample taken no sooner than four hours before, and no later than one hour
  before, the end of the last scheduled ice use that day
- Sampled at center ice, or at the perimeter on the center line, 3 to 6 feet
  above the ice surface
- If combustion resurfacing is used fewer than four times in a week, a sample is
  required after each use
- NO2 readings below 0.5 ppm are recorded as "below detection"
- All samples recorded in a retained log

The gaps to close:
1. The MA sampling_rules row has min_per_week, min_weekday, min_weekend and
   post_resurfacing_minutes, but post_resurfacing_minutes appears to be parsed
   and never read. Confirm, then make it enforced.
2. The 4-hour/1-hour end-of-day window is not represented in the ruleset at all.
   Add it, along with the fewer-than-four-resurfacings rule and the sampling
   location/height requirement.
3. facility_air_quality_config.frequency_config is selected in
   load-compliance.ts and never used. Either wire it up or remove it.
4. "An admin may tighten but never loosen below the jurisdictional floor" is
   enforced in the server action only. There is no DB constraint on
   threshold_overrides, so a direct PostgREST update can write a loosened
   ceiling, and effectiveTiers does not clamp to the profile floor. Enforce this
   at the database boundary.
5. Generate required sampling tasks and surface them on the day's Daily Report
   and to the assigned operator. This does not exist today — only a single
   "on schedule / behind by N" badge.
6. A sample entered outside a required window is accepted but flagged
   non-compliant with the specific criterion it missed. Never silently reject an
   operator's reading.
7. Must work offline. Rule evaluation happens locally against the cached ruleset
   and is re-verified server-side on sync.

Start by showing me the current MA row and exactly which of its fields are read
at evaluation time.
```

*Corrections applied:* rewritten from "build a jurisdiction rule engine, seed
Massachusetts" to closing specific gaps, since the engine and all four
jurisdictions are already seeded.

---

### N-2. Regulator-ready export packs

**Status:** PARTIAL — substantial PDF infrastructure exists. Depends on I-2.

**Current state (verified 2026-07-24):** `src/lib/notifications/pdf/registry.tsx`
registers React-PDF renderers for accident reports, air quality, daily reports, ice
depth, incident reports, and refrigeration. A dedicated regulator-style log PDF
already exists at `src/app/admin/air-quality/log/_lib/log-pdf.tsx`. Ad-hoc export
running is at `src/app/admin/exports/` with `src/lib/exports/`.

```
Build one-click regulator export packs for the Air Quality module.

Current state: a React-PDF renderer registry already exists
(src/lib/notifications/pdf/registry.tsx) covering accident reports, air quality,
daily reports, ice depth, incident reports and refrigeration, and there is
already a regulator-style air-quality log PDF at
src/app/admin/air-quality/log/_lib/log-pdf.tsx. Extend these; do not start a new
PDF stack.

- A PDF bundle formatted to the specific log fields each jurisdiction requires,
  selected by the facility's jurisdiction setting (facility_air_quality_config).
  Start with Massachusetts.
- Selectable date range with presets: last 30 days, current season, custom. Note
  the existing ad-hoc export path caps ranges at 90 days — decide with me whether
  that cap applies here.
- Includes the sample log, any exceedances with their corrective actions and
  follow-up samples, the sampling equipment record, and operator training
  attestations.
- Includes the audit chain verification result for the covered period — a
  statement that records are unmodified, or an itemized list of corrections with
  reasons. This DEPENDS ON I-2; if hash chaining is not yet in place, say so and
  emit the section as "not yet available" rather than a claim you cannot back.
- Cover page: facility name, address, jurisdiction, reporting period,
  generated-by, generated-at.
- Branded with navy #002244 and Space Grotesk, lime #4DFF00 used sparingly, via
  the tokens in src/lib/tokens.ts. It goes to a health inspector, so err formal.

Extend the same pattern to Refrigeration and Incident Reports afterward.
```

*Corrections applied:* added the existing PDF infrastructure, and made the I-2
dependency explicit so the pack cannot assert an unverifiable integrity claim.

---

### N-3. Exceedance escalation workflow

**Status:** PARTIAL — tier model and dispatch pipeline exist; the workflow does not.

**Current state (verified 2026-07-24):** `air_quality_compliance_profiles.tiers`
already models escalating tiers per metric with precedence
`evacuation > notification > corrective`, and `escalation_rules` holds notification
deadlines (e.g. MA's fire-department-within-1-hour). A full notification and
dispatch pipeline exists at `src/lib/notifications/`. Missing: corrective-action
capture, follow-up-sample tracking, and the auto-linked incident record.

```
Build the threshold escalation workflow in the Air Quality module. The tier model
already exists — extend it.

Current state: air_quality_compliance_profiles.tiers already encodes three
escalating levels per metric (corrective, notification, evacuation) with
precedence evacuation > notification > corrective, and escalation_rules already
holds jurisdiction notification deadlines. src/lib/notifications/ provides
dispatch, templating, recipient resolution and email transport. What is missing
is the operator-facing workflow on top.

On entry of a reading at or above a threshold:
- Correction level: prompt for corrective action from an admin-configurable
  list, require a follow-up sample within a configurable window, and track until
  the follow-up clears.
- Notification level: everything above, plus trigger a notification chain
  (configurable recipients, in-app and email) through the existing dispatch
  pipeline, and require documentation of who was notified and when. Honor the
  jurisdiction's deadline from escalation_rules.
- Evacuation level: everything above, plus an immediate high-visibility alert, an
  evacuation-initiated timestamp, and a mandatory incident record automatically
  linked to the reading.

Every escalation, notification, corrective action, and follow-up sample writes to
the audit chain. The full escalation history must appear in the regulator export
pack.

Must work offline — an operator taking a reading in the rink with no signal still
needs the escalation prompt. Use the existing service-worker queue.
```

*Corrections applied:* premise changed from "build a tiered structure" to extending
the existing tier model and dispatch pipeline.

---

### N-4. Certification-aware scheduling

**Status:** PARTIAL — the expiry bug is **fixed** (Defect 3, migration 209). Document upload, the coverage report, and DB-boundary enforcement remain open.

**Current state (verified 2026-07-24):** `employee_certifications`
(`supabase/migrations/00000000000057_employee_certifications.sql`),
`certification_types`
(`supabase/migrations/00000000000169_certification_types.sql`), and
`job_area_certification_requirements`
(`supabase/migrations/00000000000116_job_area_cert_requirements.sql`) all
exist. Enforcement runs through `scheduling_assignment_violations`
(`supabase/migrations/00000000000118_scheduling_assignment_violations.sql`) and is
a hard block inside the governed RPCs, with logged overrides in
`schedule_assignment_overrides` and an expiry cron
(`supabase/migrations/00000000000158_scheduling_expiry.sql`). Application logic is
in `src/app/admin/scheduling/_lib/enforcement.ts` with unit tests.

```
Close the gaps in certification-aware scheduling. Most of it is already built —
read this first.

Current state: employee_certifications (migration 57), certification_types
(migration 169) and job_area_certification_requirements (migration 116) exist.
scheduling_assignment_violations (migration 118) computes violation codes and is
a hard block inside the governed RPCs. Cert overrides are logged immutably in
schedule_assignment_overrides (migration 148). There is an expiry cron (migration
158) and app logic in src/app/admin/scheduling/_lib/enforcement.ts with tests.
Do NOT rebuild any of this.

The gaps:
1. BUG — certification expiry is validated against current_date, not the shift
   date. Migration 169 checks `c.expires_at is null or c.expires_at >=
   current_date`, so a shift three weeks out passes with a certification expiring
   next week, and publish-time re-validation repeats the same mistake. Compare
   against the shift's starts_at instead. Fix this first.
2. Enforcement lives in the RPCs, but there is no trigger on schedule_shifts, so
   a direct PostgREST assignment of an uncertified employee to a DRAFT shift
   succeeds and is only caught at publish. Decide with me whether to push
   enforcement to the DB boundary.
3. No document upload — employee_certifications has name, issuer, issued_at,
   expires_at and notes, but no file or storage reference. Add it, reusing the
   facility_documents storage pattern.
4. No coverage report. /admin/scheduling/compliance currently renders only the
   cert-override audit log. Add: who is missing or expiring which certification,
   coverage by job area and shift, and expiring in 30/60/90 days.
5. Automated reminders to the employee and their manager at configurable
   intervals, via the existing notification dispatch pipeline.

Note the manager override already exists and is logged — do not duplicate it.
Extend supabase/tests/rls_isolation.sql with an assertion for the expiry fix.
```

*Corrections applied:* rewritten from "add certification awareness" to a gap list;
Defect 3 promoted to step 1; `facility_manager` → `manager`; the publish-lock probe
tail replaced with the RLS harness.

---

### N-5. CO/NO2 meter integration

**Status:** OPEN — but the prompt's stated premise is wrong.

**Current state (verified 2026-07-24):** The ice-depth caliper integration is
**not** Web Bluetooth. The caliper pairs at the OS level as a Bluetooth *keyboard*,
and `src/app/reports/ice-depth/_components/submission-form.tsx` does
save-and-advance on the DATA keystroke, with an in-form pairing guide. There is no
`navigator.bluetooth` or GATT code anywhere in the repo.

```
Add direct meter integration to Air Quality.

IMPORTANT — correct your premise first. The existing ice-depth caliper
integration is NOT Web Bluetooth. The caliper pairs at the OS level as a
Bluetooth KEYBOARD, and the form advances on the DATA keystroke
(src/app/reports/ice-depth/_components/submission-form.tsx). There is no
navigator.bluetooth or GATT code in this repo. So "follow the same pattern" means
HID keystroke capture, which may or may not be the right approach for a gas
meter.

Target common rink instruments: Bacharach, Analox, TSI, MSA Altair. Research
which of these expose a Bluetooth, HID, or serial interface with a documented
protocol, and tell me what is actually feasible before building. If Web Bluetooth
is the right answer here, say so and note that it would be the first use of it in
this codebase, with the browser-support consequences that carries.

Requirements:
- Direct capture of CO and NO2 readings with instrument model and serial number
  recorded against the sample.
- Manual entry always remains available as a fallback.
- A directly captured reading is flagged as instrument-sourced in the audit chain
  and the export pack — meaningfully stronger evidence than a typed number.
- Calibration date tracking per instrument, with a warning when a sample is taken
  on an out-of-calibration meter.
- Must work offline.
```

*Corrections applied:* the "same pattern as the existing Bluetooth caliper
integration" premise was corrected — that integration is HID-keyboard based.

---

### N-6. Parity gap fields — ice quality metrics

**Status:** PARTIAL — two of the four have partial coverage.

**Current state (verified 2026-07-24):** The ice-depth module
(`supabase/migrations/00000000000014_ice_depth_schema.sql`) already captures a
per-point measurement grid, which is the closest thing to levelness. Ice surface
temperature exists as a configurable refrigeration reading field
(`supabase/migrations/00000000000109_seed_refrigeration_fields_thresholds.sql`).
Ice hardness and water chemistry are genuinely absent — no hardness, durometer,
TDS, alkalinity, pH, or conductivity anywhere.

```
Add the ice quality measurement types we're missing. Two of the four already have
partial coverage — check before building.

Current state:
- Levelness: the ice-depth per-point measurement grid (migration 14) already
  captures this data. Derive levelness from the existing grid and zones rather
  than adding a parallel measurement type.
- Ice surface temperature: already exists as a configurable refrigeration reading
  field (migration 109). Decide with me whether to surface it in ice operations
  or leave it in refrigeration — do not duplicate the field.
- Ice hardness: genuinely absent.
- Water quality (TDS, hardness, alkalinity, temperature, sample source):
  genuinely absent. Note ice-make already logs water_temp_c and water_used_gal
  (migration 13) — thermal/volumetric, not chemistry.

For each:
- Measurement types, units, and normal ranges are admin-configurable, never
  hardcoded
- Normal ranges displayed inline at entry, consistent with the refrigeration
  NormalRangeHint pattern
- Trend charting over time
- Offline capable
- Included in the audit chain

Reuse the existing ice-depth measurement template pattern rather than inventing a
new one. No photo documentation on any of these — same rule as Ice Depth.
```

*Corrections applied:* levelness and surface temperature reclassified from "the
competitor has and we don't" to partially covered, with reuse pointers.

---

### N-7. Resurfacer maintenance and hour meter

**Status:** PARTIAL — hour meter and blade tracking already exist.

**Current state (verified 2026-07-24):** `src/app/reports/ice-operations/types.ts`
already defines a `blade_change` operation type and `ice_resurfacer` / `blade_set`
equipment types, with `machine_hours`, `hours_run`, `blade_serial`, and
`hours_at_change` payload fields, plus dedicated forms. Missing: maintenance
schedules, service history, cost tracking.

```
Add a resurfacer maintenance module on top of what Ice Operations already
captures.

Current state: src/app/reports/ice-operations/types.ts already has a blade_change
operation type, ice_resurfacer and blade_set equipment types, and machine_hours /
hours_run / blade_serial / hours_at_change payload fields, with forms at
src/app/reports/ice-operations/[operationType]/_components/. ice_operations_equipment
(migration 13, extended by 75 and 166) is the machine registry. Hour accrual and
blade-change records therefore already exist — build on them.

Add:
- Maintenance schedules defined by hours or calendar interval, admin-configurable
- Due and overdue alerts surfaced on the Daily Report
- Service history: date, hours at service, work performed, parts, cost,
  performed by
- Blade inventory and sharpening history, linked to the existing blade_change
  records rather than a new event type
- Battery, wash water, and snow tank records for electric and conventional
  machines

Trend view: cost per operating hour per machine, to support replacement timing.

Note ice_operations_fuel_types (migration 76) already classifies machines by fuel
type for circle-check template selection — reuse it rather than adding a second
classification.
```

*Corrections applied:* the hour-meter and blade-change requirements were reframed as
existing, since both are already captured.

---

### N-8. Facility traffic and patron counts

**Status:** OPEN — confirmed absent.

**Current state (verified 2026-07-24):** No attendance, patron, headcount, or
occupancy capture exists. The only matches are checklist item *text* in the daily
report seeds (`supabase/migrations/00000000000106_seed_daily_report_checklists.sql`)
— e.g. "Reconcile the session admissions count" — which are checkbox prompts with no
numeric field behind them. This would be a new module (the canonical set is the 11
keys in `src/lib/modules/module-keys.ts`).

```
Replace the standalone patron count spreadsheet with a module.

Current state: genuinely absent. Note that daily-report checklists already
include prompts like "Reconcile the session admissions count" and "Monitor
session capacity and enforce headcount limits" (migration 106) — but these are
checkbox text with no numeric capture behind them. Wiring those existing
checklist items to real counts is probably the cheapest path in; tell me if you
agree.

- Counts by session type, admin-configurable, matching how ice is actually sold
- Entry from the Daily Report front desk area tab so it happens where staff
  already are
- Optional per-session capacity with a warning at threshold
- Trends by day of week, session type, and time of day
- Season-over-season comparison
- Export to CSV and into the executive report

This would be a new toggleable module — add its key to
src/lib/modules/module-keys.ts and the facility-module seed.

Keep entry to two taps for a front desk staffer mid-session. Offline capable.
```

---

### N-9. Equipment inventory register

**Status:** PARTIAL — a real per-asset register already exists for dasher boards.

**Current state (verified 2026-07-24):** `dasher_boards_assets` with
`dasher_boards_asset_subtypes`, `dasher_boards_asset_events`,
`dasher_boards_retired_labels`
(`supabase/migrations/00000000000191_dasher_boards_schema.sql`) and
`dasher_boards_asset_checks`
(`supabase/migrations/00000000000205_dasher_boards_asset_checks.sql`) constitute a
genuine per-asset identity, lifecycle-event, and retirement model. Module-scoped
equipment config tables also exist for refrigeration, ice operations, and air
quality. There is no cross-module asset table.

```
Build a general equipment inventory register as the foundation for capital
planning.

Current state — do not start from scratch. The dasher-boards module already
implements a real per-asset register: dasher_boards_assets with subtypes,
asset_events (lifecycle), retired_labels, and asset_checks (condition), across
migrations 191 and 205. Study that model first and generalize it rather than
inventing a second pattern. Separately, refrigeration, ice operations and air
quality each have module-scoped equipment CONFIG tables (migrations 11, 12, 13) —
these are configuration, not asset identity, and should be linked to rather than
replaced.

Per asset: name, category (admin-configurable), manufacturer, model, serial,
install date, expected service life, replacement cost, current condition score,
location, warranty expiry, vendor, and document attachments for manuals and
service contracts (reuse facility_documents, migration 85).

- Link assets to the modules that already reference them: compressors to
  Refrigeration, resurfacers to Ice Operations, dasher board sections to the
  existing dasher-boards assets.
- Condition scores update from inspection results rather than requiring separate
  entry — dasher_boards_asset_checks already does this; follow it.
- Filterable register view with export.

Tell me explicitly whether generalizing dasher_boards_assets or building
alongside it is the better call, and why. This is deliberately the substrate for
capital planning — design the schema with that in mind.
```

*Corrections applied:* added the dasher-boards register as the pattern to
generalize, rather than treating this as greenfield.

---

### N-10. Work orders and preventive maintenance

**Status:** OPEN — confirmed absent under every synonym checked.

**Current state (verified 2026-07-24):** No work order, service request,
maintenance schedule, or PM table exists. The nearest adjacent structures are
`dasher_boards_issues` (issue logging without a lifecycle) and the various
`*_followup_notes` tables.

```
Add work orders and preventive maintenance, built on the equipment inventory
register (N-9).

Current state: genuinely absent — no work order, service request, or PM schedule
table. The nearest adjacent structures are dasher_boards_issues (migration 191),
which logs issues without a work-order lifecycle, and the per-module
*_followup_notes tables. Consider whether dasher_boards_issues should be
generalized into the work-order model rather than left parallel.

- Work order creation from any module — an incident, a failed inspection item, a
  refrigeration reading out of range, or standalone
- Status workflow: open, assigned, in progress, on hold, complete, verified.
  Statuses admin-configurable.
- Priority levels, assignment to staff, due dates, labor hours, parts, cost
- PM schedules by calendar or meter reading, auto-generating work orders when
  due. Note Ice Operations already accrues machine_hours — use it as the meter
  source rather than adding separate entry.
- Overdue surfaced on the Daily Report and the manager dashboard
- Full history per asset, feeding the condition score

Offline capable for field completion. This is a new write path — add its
rejection cases to supabase/tests/rls_isolation.sql.
```

*Corrections applied:* the publish-lock probe tail replaced with the RLS harness.

---

### N-11. OSHA 300 and 300A generation

**Status:** OPEN — no recordability logic exists.

**Current state (verified 2026-07-24):** `accident_reports`
(`supabase/migrations/00000000000010_accident_reports_schema.sql`) has a
`workers_comp` boolean, `workers_comp_acknowledged_at`, an
`accident_workers_comp_settings` table, and dropdowns for location, activity,
severity, medical attention, and primary injury type. There is no OSHA
classification, no days-away or restricted-duty counters, and no 300-log fields.

```
Add OSHA recordkeeping generation from the Accident Reports module.

Current state: accident_reports (migration 10) captures injured person, contact,
age, description, occurred_at, and dropdown FKs for location / activity /
severity / medical_attention / primary_injury_type, plus a workers_comp boolean
and an accident_workers_comp_settings table. There is NO OSHA classification, no
days-away or restricted-duty counters, and no 300-log fields. The medical
attention dropdown includes a first_aid option, which is relevant to the
recordability determination.

- Classify each staff accident against OSHA recordability criteria, with a guided
  determination flow rather than asking a rink supervisor to interpret the
  standard cold.
- Auto-populate the OSHA Form 300 log from recordable incidents.
- Generate Form 301 incident reports.
- Generate the Form 300A annual summary with the certification block, ready for
  the February 1 posting deadline.
- Multi-year retention consistent with the retention engine — note that accident
  reports are supposed to carry a 365-day minimum but that floor is currently
  UI-only (see I-4); OSHA requires five years, so fix I-4 first or this will be
  built on a retention model that can be driven to delete the underlying records.
- Privacy case handling — certain injury types must be recorded without the
  employee name on the 300 log. Enforce this automatically.

Research current OSHA form requirements before building; do not rely on memory
for the form fields. Flag anything that requires a compliance professional's
review rather than guessing.
```

*Corrections applied:* added the I-4 retention dependency, which is a genuine
blocker for a five-year OSHA retention requirement.

---

### N-12. Ammonia compliance module

**Status:** OPEN — research-first prompt; stands as written.

**Current state (verified 2026-07-24):** No ammonia-specific compliance structures
exist. Refrigeration captures compressor readings and machine hours
(`supabase/migrations/00000000000125_refrigeration_machine_hours_per_compressor.sql`).
`facility_documents` (`supabase/migrations/00000000000085_facility_documents.sql`)
provides document storage with an `emergency_action_plan` category that this module
could reuse.

```
Scope an ammonia refrigeration compliance module. Research this before proposing
anything — I want to know what the actual regulatory obligations are and what
facilities currently do to meet them.

Current state: no ammonia-specific structures exist. Refrigeration captures
compressor readings and per-compressor machine hours (migration 125).
facility_documents (migration 85) already provides document storage and includes
an emergency_action_plan category — reuse it rather than adding a document store.

Research first:
- OSHA Process Safety Management (29 CFR 1910.119) applicability threshold for
  anhydrous ammonia and what documentation it requires
- EPA Risk Management Program (40 CFR 68) requirements and thresholds
- IIAR standards relevant to ice rink engine rooms, particularly IIAR 6 for
  inspection, testing, and maintenance
- What records a rink above the threshold must retain and for how long

Then propose a module covering: ammonia detector testing and calibration logs,
engine room inspection routines, mechanical integrity records, lockout/tagout
logging, emergency response plan storage, drill records, and operator training
documentation. Note the overlap with N-17 (ERP and drill log) and tell me whether
these should be one module or two.

Tell me honestly whether this is a real gap in the market or whether existing
PSM/RMP compliance software already covers it adequately for rinks. I'd rather
know now.
```

---

### N-13. Capital planning from inspection data

**Status:** OPEN — confirmed absent. Depends on N-9.

**Current state (verified 2026-07-24):** No capital, capex, depreciation, service
life, replacement cost, or condition score structures exist. The one real
condition-score source already in the codebase is
`dasher_boards_asset_checks`.

```
Build capital planning on top of the equipment inventory register (N-9). This is
the feature that makes RinkReports a director-level tool rather than a supervisor
tool.

Current state: genuinely absent. The one existing condition-score source is
dasher_boards_asset_checks (migration 205), which already derives condition from
inspection results — that is the input this feature needs, and N-9 should
generalize it first. Do not start this before N-9 exists.

- Five and ten year capital forecast generated from asset age, expected service
  life, condition score, and replacement cost
- Condition scores driven by inspection data already being captured, especially
  the dasher board inspection module
- Replacement cost inflation assumption, admin-configurable
- Scenario comparison: defer versus replace, with a projected maintenance cost
  curve for the defer case
- Board-ready PDF export with a project summary, condition evidence including
  inspection photos, cost basis, and a recommended year. Reuse the React-PDF
  stack in src/lib/notifications/pdf/.

Model the output on a capital request document: problem statement, condition
evidence, options considered, recommendation, cost. Use the dasher board
replacement proposal structure as the template.
```

---

### N-14. Ice depth heat map and trend analysis

**Status:** PARTIAL — analytics and diagram rendering already exist.

**Current state (verified 2026-07-24):** `src/app/admin/ice-depth/_lib/analytics.ts`
with `_components/analytics-tab.tsx` already provides ice-depth analytics, and the
rink diagram renders with per-rink overlays
(`supabase/migrations/00000000000207_rink_diagram_overlays_per_rink.sql`), including
inside PDFs via `src/lib/notifications/pdf/_components/rink-diagram.tsx`.

```
Add zone-level trend visualization to Ice Depth.

Current state: ice-depth analytics already exist
(src/app/admin/ice-depth/_lib/analytics.ts, _components/analytics-tab.tsx), and
the rink diagram already renders with per-rink overlays (migrations 199, 207)
including inside PDF exports
(src/lib/notifications/pdf/_components/rink-diagram.tsx). Extend these rather
than building a second visualization layer.

- Heat map overlay on the existing rink diagram showing current depth by zone
  against target, with a diverging color scale that stays legible for colorblind
  users — do not rely on red/green alone. Use the semantic tokens in
  src/app/globals.css so it works in both light and dark themes.
- Time scrubber to view any prior date and animate change across a season.
- Zone-level trend charts identifying chronically thin or thick areas.
- Recommended shave or flood scheduling based on trend and target depth, with the
  recommendation logic transparent and admin-tunable rather than a black box.

Reuse the admin-built measurement templates. No photo documentation. Must render
acceptably offline from cached measurements.
```

---

### N-15. Energy tracking tied to ice depth

**Status:** OPEN — confirmed absent.

**Current state (verified 2026-07-24):** No kWh, utility, consumption, or demand
charge capture exists. Refrigeration logs compressor readings, brine temperatures,
and machine hours, which are the correlation inputs this feature would need.
`ice_operations_fuel_types` classifies machines for checklist template selection,
not consumption.

```
Add energy tracking that connects ice depth to operating cost. This is the
strongest ROI argument available in this industry and it's the number that gets
capital committed.

Current state: genuinely absent — no kWh, utility, or demand-charge capture.
Note that the correlation INPUTS largely exist already: refrigeration logs brine
and condenser temperatures and per-compressor machine hours (migrations 109,
125), ice depth has per-point measurements (migration 14), and there is an
outdoor temperature helper at src/lib/weather/current-temp.ts. Also note
ice_operations_fuel_types (migration 76) is checklist template selection, not
consumption — do not mistake it for energy data.

- Manual or utility-import monthly kWh and cost entry, admin-configurable rate
  structure including demand charges
- Correlate consumption against average ice depth, ice surface temperature, brine
  temperature, and outdoor conditions over the same period
- Estimated cost per additional quarter-inch of ice, derived from the facility's
  own data rather than a generic industry figure
- Season-over-season comparison
- Feed the result into the executive report as a dollar figure

Be honest in the UI about confidence — early on there won't be enough data to
make a defensible claim, and overstating it would damage credibility with exactly
the technical buyers we want. Show the sample size and don't display an estimate
until it's meaningful.
```

---

### N-16. Booking system schedule feed

**Status:** PARTIAL — the repo already does iCal, but in the opposite direction.

**Current state (verified 2026-07-24):** RinkReports **publishes** an authenticated
iCal feed: `src/lib/ics.ts` emits `BEGIN:VCALENDAR` / `BEGIN:VEVENT` and has no
parser; `src/app/api/schedule-ics/[token]/route.ts` exports `GET` only; and
`supabase/migrations/00000000000168_schedule_ack_and_ics_tokens.sql` states the
tokens exist "so Google/Apple Calendar can subscribe." Import is genuinely absent.

```
Add read-only ice schedule IMPORT so Daily Reports pre-populate with the day's
events.

IMPORTANT — direction matters. This repo already does iCal, but outbound: it
PUBLISHES an authenticated feed so Google/Apple Calendar can subscribe
(src/lib/ics.ts is emit-only with no parser; src/app/api/schedule-ics/[token] is
GET-only; migration 168). There is no inbound feed handling at all. You are
adding the opposite direction, so you cannot reuse src/lib/ics.ts as-is — but do
match its conventions.

- iCal/ICS subscription support first, since most booking platforms expose it —
  covers EZFacility, Dash, Frontline Solutions, RecTrac and InnoSoft Fusion to
  varying degrees.
- Per-facility feed configuration in the Admin Panel, multiple feeds per
  facility.
- Imported events appear on the Daily Report and can be referenced from Ice
  Operations entries.
- Read-only. We never write back to a booking system.
- Graceful degradation: if the feed is unreachable, the Daily Report works
  exactly as it does now.
- Cache for offline use.
- Treat the feed as untrusted input: an external URL fetched server-side is an
  SSRF surface, and VEVENT fields are attacker-controlled text. Say how you'll
  handle both.

Research which of those platforms actually publish a usable iCal feed before
building, and tell me what you find. This neutralizes the "we already have a
booking system" objection at low cost.
```

*Corrections applied:* clarified that the existing iCal support is outbound-only, so
this is not an extension of `src/lib/ics.ts`; added the SSRF/untrusted-input
requirement.

---

### N-17. Emergency response plan and drill log

**Status:** OPEN — with an existing hook.

**Current state (verified 2026-07-24):** `facility_documents`
(`supabase/migrations/00000000000085_facility_documents.sql`) already includes an
`emergency_action_plan` category, surfaced through `src/lib/facility-documents.ts`.
That is storage only — there is no acknowledgment tracking, no drill schedule, and
no drill completion records. Note that "evacuation" elsewhere in the codebase is an
air-quality threshold tier name, not a drill.

```
Productize the emergency response plan work already done for Tennity into a
module.

Current state: facility_documents (migration 85) ALREADY has an
emergency_action_plan category, surfaced via src/lib/facility-documents.ts. Build
acknowledgment and drills on top of that storage rather than adding a second
document system. Note that "evacuation" elsewhere in this codebase is an
air-quality threshold tier name, not a drill — don't conflate them.

- ERP document storage with versioning and an acknowledgment log per staff
  member. Note migration 168 already implements a schedule acknowledgment
  pattern — reuse its shape.
- Emergency contact directory, admin-configurable roles
- Drill scheduling and completion records: type, date, participants, duration,
  observations, corrective actions
- Drill types admin-configurable — ammonia release, evacuation, fire, medical,
  severe weather, active threat
- Overdue drill alerts on the manager dashboard
- Annual summary export for insurance and regulatory review
- ERP accessible offline; this is the one document that must be readable when the
  building has no connectivity. Note the service worker deliberately does NOT
  cache authenticated HTML (public/sw.js) — say how you'll make the ERP available
  offline without breaking that rule.

See also N-12 (ammonia compliance), which needs drill records and operator
training documentation too.
```

*Corrections applied:* added the existing `emergency_action_plan` category and the
acknowledgment prior art; flagged the SW authenticated-HTML caching constraint.

---

### N-18. Executive reporting and quarterly board pack

**Status:** OPEN — with one narrow precedent.

**Current state (verified 2026-07-24):** `src/app/dashboard/page.tsx` is strictly
single-facility. One genuine cross-facility rollup exists: the RPC
`get_employee_counts_by_facility()`
(`supabase/migrations/00000000000177_rpc_scoping_and_public_form_rate_limit.sql`),
rendered in `src/app/admin/super-admin/_components/facilities-panel.tsx`. There is
no organization or portfolio table, no cross-facility *operational* aggregation, and
the export pipeline is hard-scoped to the caller's own facility
(`src/lib/exports/authorize.ts`).

```
Build the executive reporting layer that justifies the Complete tier.

Current state: src/app/dashboard/page.tsx is strictly single-facility, and the
export pipeline is hard-scoped to the caller's own facility_id
(src/lib/exports/authorize.ts). There is exactly ONE existing cross-facility
rollup: the RPC get_employee_counts_by_facility() (migration 177), rendered in
src/app/admin/super-admin/_components/facilities-panel.tsx. Study it as the
precedent for how cross-facility aggregation is done safely here, then generalize
it. There is no organization or portfolio table — if multi-facility rollup needs
one, propose it explicitly rather than assuming facility_id grouping is enough.

- Manager and director dashboard: compliance status across all modules, open work
  orders, overdue PMs, certification gaps, incident trend, patron counts, energy
  cost. Several of these depend on modules that don't exist yet (N-8, N-10,
  N-15) — degrade gracefully and tell me which tiles will be empty.
- Auto-generated quarterly board pack as a branded PDF: operational summary,
  compliance attestation with audit chain verification (depends on I-2), incident
  and accident summary, capital forecast highlights, patron trends, energy cost.
- Multi-facility rollup for super_admin with per-facility drill-down. Prove the
  rollup cannot leak across facilities for a non-super_admin caller — add
  assertions to supabase/tests/rls_isolation.sql.
- Configurable scheduled email delivery via the existing notification pipeline
  and cron.

Written for someone who has fifteen minutes and needs to know whether the
building is being run properly. Lead with exceptions, not with everything that
went right.
```

*Corrections applied:* `org_admin` → `super_admin`; added the existing rollup RPC as
precedent and the cross-module dependencies.

---

### N-19. Enterprise trust and procurement artifacts

**Status:** OPEN — retained, minus its marketing-site bullet.

**Current state (verified 2026-07-24):** `docs/` already contains material that
feeds several of these: `docs/DEPLOY.md`, `docs/READINESS.md`,
`docs/RR56-LAUNCH-RUNBOOK.md`, `docs/security-audit-exceptions.md`, and
`docs/360-REVIEW-AND-14-DAY-PLAN.md`.

```
Help me assemble the procurement package that universities and municipalities ask
for. Tell me which of these I can produce myself and which genuinely need outside
help.

Existing material to draw on rather than rewrite: docs/DEPLOY.md,
docs/READINESS.md, docs/RR56-LAUNCH-RUNBOOK.md, docs/security-audit-exceptions.md,
and docs/360-REVIEW-AND-14-DAY-PLAN.md.

- Security overview document: architecture, encryption at rest and in transit,
  RLS and tenant isolation model, backup and recovery, incident response
- Data Processing Agreement template
- Documented uptime SLA and a public status page
- Business continuity and disaster recovery plan, including what happens to
  customer data if Max Facility LLC ceases operating — source code escrow or data
  export guarantee
- SOC 2 Type I readiness assessment, and a realistic view of cost and timeline
  via Vanta or Drata
- A written answer to the single-founder concentration risk question, because it
  will be asked

Draft what you can. For anything requiring an auditor, attorney, or insurer, say
so plainly rather than producing something that looks official and isn't.
```

*Corrections applied:* the "security overview page for the website" bullet became a
document, since the marketing site is not in this repo.

---

## Dropped prompts

**I-9 through I-12 were removed**, not lost. They targeted the maxfacility.com
marketing site — credibility fixes, module-count reconciliation, pricing
restructure, and removal of the $750 price anchor. That site is **not in this
repository**: the only `maxfacility` string anywhere in the codebase is an email
override constant in `src/lib/notifications/transport/email.ts`. Those four prompts
need to live wherever that site's source does.

One factual note for whoever picks them up: I-10 asserts a "canonical ten" module
list. The application's real module set is **eleven** (see the appendix), and
includes Facility Paperwork and Dasher Boards, neither of which appears in either
marketing list. Admin Panel is not a toggleable module at all. Reconcile against the
appendix, not against the old marketing copy.

Numbering is left with the gap so existing references to I-1…I-8 and N-1…N-19 stay
valid.

---

## Appendix — canonical module list

The single source of truth is `TOGGLEABLE_MODULE_KEYS` in
`src/lib/modules/module-keys.ts`, which must stay in sync with the seed in
`supabase/migrations/00000000000144_facility_modules.sql`.

| Key | Label |
|---|---|
| `daily_reports` | Daily Reports |
| `ice_depth` | Ice Depth |
| `ice_operations` | Ice Operations |
| `refrigeration` | Refrigeration |
| `air_quality` | Air Quality |
| `incident_reports` | Incidents |
| `accident_reports` | Accidents |
| `scheduling` | Scheduling |
| `communications` | Communications |
| `facility_paperwork` | Facility Paperwork |
| `dasher_boards` | Dasher Boards |

Dashboard and Admin Center are deliberately **never toggleable** and are not
modules in this sense.

Modules that several Part 2 prompts would add as *new* keys: patron counts (N-8),
work orders (N-10), capital planning (N-13), energy (N-15), ERP/drills (N-17), and
booking import (N-16).

---

## Sequencing

The original ordering opened with the marketing site, then I-1 through I-5. With
the site dropped and the verification findings in hand, the real order is:

1. ~~**I-4**~~ — **done for the data-loss path** (migration 208). What remains of
   I-4 — legal hold, flag-for-review instead of hard delete, retention-aware
   DELETE guards — is feature work, no longer urgent, and can be scheduled
   alongside the rest.
2. **I-5** — the privilege audit is now the strongest next move. Defect 1 was a
   real instance of "enforced in the UI, not in the database", and the audit is
   built to find its siblings systematically rather than one at a time.
3. **I-2** — hash chaining. **Promoted above I-3** following the Defect 2
   correction: `audit_logs` is trigger-populated on every compliance table, so it
   is a sound substrate for a chain today. The original ordering assumed the log
   could be bypassed, which was wrong.
4. ~~**I-1**~~ — **done** (migration 210). Defect 4 claims A and B were confirmed
   and closed with guard triggers; claim C was refuted as framed. Defect 3 under
   N-4 is done (migration 209). What remains under I-1 is only claim C's
   unification choice, which needs a product decision — see Defect 4.
5. **I-3** — reclassified as feature work after the Defect 2 correction:
   immutability and amendment semantics (reason codes, linked versions,
   approval), plus closing the module change-log gap so a module's History tab
   matches what `audit_logs` already records. No longer urgent.
6. **I-8** — encode the confirmed defects as permanent probes so none can regress.
   The `RETENTION-208` block added for Defect 1 is the template.
7. **I-6 and I-7** in parallel — both procurement gates, neither started.
8. **N-1 and N-3** — cheap now that the compliance-profile engine exists.
   **N-2** depends on I-2.
9. Everything else as the pipeline demands. N-6 through N-9 are relatively cheap
   and close competitive gaps quickly.

Run the I-8 probes after each of these.
