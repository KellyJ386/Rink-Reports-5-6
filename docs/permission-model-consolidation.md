# Permission model consolidation — findings & plan

**Status:** investigation only. No destructive change has been made to the
database. This documents a half-finished migration discovered while reconciling
the "Rink Reports 5-6" Supabase project (`bqbdgwlhbhabsibjgwmk`) with the repo,
and lays out a safe path to finish it.

## TL;DR

The app runs **two permission systems at once**, split across layers:

- **RLS policies / resolver functions** read **`user_permissions`** (the model
  introduced by migration `00000000000077_user_permissions_replace.sql`).
- **Application code** (every report module's access gate) reads
  **`module_permissions`** + **`role_module_permission_defaults`** — the *old*
  model that 077 was supposed to retire.

Migration 077 moved the RLS layer to `user_permissions` but the application was
never moved off `module_permissions`. The legacy tables are therefore **still
load-bearing in application code** and must not be dropped until that code is
migrated. Dropping them now would break staff access checks across every module.

## Evidence (live database + `origin/main`)

Row counts in the live DB:

| Table | Rows | Role in the system |
|---|---|---|
| `user_permissions` | 140 | **Active** — what the RLS resolver reads |
| `role_permission_defaults` | 218 | **Active** — seeds `user_permissions` for new users (auto-seed trigger) |
| `role_module_permission_defaults` | 30 | Legacy — read by app code, not by RLS resolver |
| `module_permissions` | 20 | Legacy — read by app code, not by RLS resolver |
| `department_module_permission_defaults` | 0 | Dead (migration 073 wanted to drop; recorded-only) |
| `facility_module_permission_defaults` | 0 | Dead (same) |

What reads what:

- Live `effective_module_permission()` / `effective_module_permission_with_source()`
  derive from `user_permissions` (confirmed in the function bodies). They do **not**
  reference `module_permissions` or `role_module_permission_defaults`.
- `origin/main` application code (the deployed app):
  - **23 files** call `.from("module_permissions")` at runtime — including the
    permission gate of **every** report module (ice-depth, accidents, air-quality,
    incidents, refrigeration, scheduling, communications, ice-operations).
  - **3 files** call `.from("role_module_permission_defaults")`.
  - **0 files** call `.from("user_permissions")` or `.from("role_permission_defaults")`.

So the application's own gating still depends entirely on the legacy tables, even
though RLS has moved on.

### App files that query `module_permissions` (must migrate before any drop)

```
src/app/admin/employees/[id]/actions.ts            (x2)
src/app/reports/accidents/actions.ts
src/app/reports/accidents/page.tsx
src/app/reports/air-quality/[locationSlug]/page.tsx
src/app/reports/air-quality/actions.ts
src/app/reports/air-quality/page.tsx
src/app/reports/communications/actions.ts
src/app/reports/communications/compose/page.tsx
src/app/reports/communications/page.tsx
src/app/reports/ice-depth/[layoutSlug]/page.tsx
src/app/reports/ice-depth/actions.ts
src/app/reports/ice-depth/page.tsx
src/app/reports/ice-operations/[operationType]/page.tsx
src/app/reports/ice-operations/actions.ts
src/app/reports/incidents/actions.ts
src/app/reports/incidents/page.tsx
src/app/reports/refrigeration/actions.ts
src/app/reports/refrigeration/page.tsx
src/app/reports/scheduling/availability/page.tsx
src/app/reports/scheduling/my-schedule/page.tsx
src/app/reports/scheduling/page.tsx
src/app/reports/scheduling/swaps/page.tsx
src/app/reports/scheduling/time-off/page.tsx
```

(Plus the 3 `role_module_permission_defaults` readers under `src/app/admin/`.)

## Why this is unsafe to "just clean up" on production

Dropping `module_permissions` / `role_module_permission_defaults` would make all
23+3 of those queries fail (the same failure mode as the missing `ice_depth_rinks`
table, but across every module at once). This is not leftover cruft — it is an
**unfinished application migration**. It must be finished in code first.

## Safe plan to finish the migration

Do this on a branch, behind the RLS isolation suite — not as an ad-hoc prod edit.

1. **Pick the target model.** `user_permissions` (per-user grid) is already the
   RLS source of truth and is populated (140 rows). Make it the single model.
2. **Add a read helper the app can share.** The DB already exposes resolver
   functions over `user_permissions`
   (`effective_module_permission`, `current_employee_module_permission`). Route
   application permission checks through these (or a thin `getModulePermission()`
   wrapper) instead of `.from("module_permissions")`.
3. **Migrate the 23 + 3 files** to the shared helper. Mechanical but must be done
   in lockstep; each report module's `page.tsx` / `actions.ts` currently reads
   `module_permissions.can_submit` and equivalents.
4. **Confirm `role_permission_defaults` covers onboarding.** New employees get
   `user_permissions` seeded from `role_permission_defaults` via the auto-seed
   trigger (`role_permission_defaults_auto_seed`). Verify no remaining writer of
   `module_permissions` is needed.
5. **Drop the legacy tables** in a final migration once no code references them:
   `module_permissions`, `role_module_permission_defaults`,
   `department_module_permission_defaults`, `facility_module_permission_defaults`.
   Add assertions to `supabase/tests/rls_isolation.sql`.
6. **Validate** with `rls_isolation.sql` (local stack) before deploying, then ship
   through the new deploy workflow.

Reversibility: steps 1–4 are code-only and revertible. Step 5 is the only
destructive step and should land alone, after 1–4 are verified in production.

## Role canon (#1) — `gm`/`supervisor` retirement

Smaller, mostly independent. The canonical role set is
`super_admin / admin / manager / staff`, but the DB still has `gm` and
`supervisor` roles (with **0 employees** on either).

Drafted as `supabase/migrations/00000000000087_retire_gm_supervisor_roles.sql`
(not yet applied). It:

- reassigns any employees `gm -> admin`, `supervisor -> manager` (defensive),
- deletes the `gm`/`supervisor` role rows — their `role_permission_defaults`
  (~67) and `role_module_permission_defaults` (~10) rows are removed via
  `ON DELETE CASCADE`,
- aligns `hierarchy_level` (manager=2, staff=3).

**Policy footnote:** 33 policies across 15 tables still list `'gm'` in their
`current_user_role()` admin arrays. Once the role rows are gone,
`current_user_role()` can never return `'gm'`, so those references are inert
no-ops — no behavioural or security impact. A mechanical `'gm'`-strip is cosmetic
and is intentionally **not** bundled into 087, because the policy set diverged
from main (migration 058 curated ~24; the rest came from the DB's own lineage)
and blanket-recreating 33 policies risks regression. Do the cosmetic cleanup, if
wanted, as a separate individually-reviewed pass.

## What was NOT changed

Nothing in this document has been executed. The role-canon migration (087) is a
reviewable draft; the permission-model consolidation requires the code migration
above before any table is dropped.

## 2026-07 addendum: module-scoped admin guards (communications audit)

The communications module audit found the two-layer gate could disagree:
`requireAdmin()` accepts the global `admin`/`admin` grant or an
employee-role fallback, while the communication RLS write policies check
`has_module_admin_access('communications')` — a *module-scoped*
`user_permissions` row with no role fallback. Fixes shipped with migrations
170/171:

- `requireModuleAdmin(moduleName)` (src/lib/auth/require-module-admin.ts)
  resolves the module-scoped `admin` grant through
  `current_user_has_permission` — the same source of truth as the RLS
  helper. Module admin consoles whose writes are RLS-gated per-module should
  call it *in addition to* `requireAdmin()` (communications does; other
  module consoles can adopt the pattern as needed).
- Migration 171 backfills `user_permissions` from role defaults for active
  employees with zero rows (accounts predating the migration-77/82
  auto-seeding), so the role fallback and the RLS layer agree again.

**Latent manager grant (decision, unchanged):** the role defaults (migration
80) give `manager` a `communications`/`admin` grant, but managers cannot pass
`requireAdmin`, so the grant is unreachable through the UI. It is left in
place deliberately — it correctly authorizes DB-level module administration
if the console gate is ever loosened per-module. Revisit only alongside a
per-module console-access design.
