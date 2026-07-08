# Phase 1 — Security & RLS Audit (Agent-SEC)

**Repo:** /home/user/Rink-Reports-5-6 · **Supabase project:** `bqbdgwlhbhabsibjgwmk`
**Date:** 2026-06-20 · **Mode:** AUDIT ONLY (no code changes)
**Stack (reconciled):** Next.js 16.2 / React 19.2 App Router; offline = SW + `/api/offline-sync` + `offline_sync_queue`. No tRPC / AI / Dexie / Stripe.
**Role model (actual):** super_admin(0) → admin(1) → manager(2) → staff(3) + custom driver(4). The audit spec's 5-tier (org_admin/facility_manager/supervisor) is WRONG; graded against actual.

## Severity summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 0 |
| 🟡 MEDIUM | 3 |
| 🟢 LOW | 5 |

**C1 (role-assignment tier guard):** ✅ CONFIRMED CLOSED in current code.
**C2 (permission-matrix grant gating):** ✅ CONFIRMED CLOSED in current code.

---

## 1A — RLS

**RLS enabled on every public table.** `list_tables` confirms `rls_enabled: true` for all ~110 tables (employees, users, facilities, all report/scheduling/communication tables, `offline_sync_queue`, `audit_logs`, `user_permissions`, etc.). No table has RLS disabled.

**Policies using `TRUE`:** The ONLY `with check (true)` in the migration set is the deliberate public "Request Information" insert path:
- `supabase/migrations/00000000000088_information_requests.sql:49-51` — `for insert to anon, authenticated with check (true)`. This is intentional (unauthenticated splash-page lead form), length-capped via a CHECK constraint (lines 28-39), and SELECT/UPDATE/DELETE are gated `is_super_admin()` (lines 55-68). Supabase advisor flags it as `rls_policy_always_true`. **🟢 LOW** — acceptable by design, but the anon key ships in the client bundle so this insert path is directly POST-able; rate-limiting / captcha is the only abuse control.

**`rate_limit_counters` — RLS enabled, no policy** (advisor `rls_enabled_no_policy`, INFO). Intentional: table is reachable only through `SECURITY DEFINER` `check_rate_limit()`; no policy = deny-all direct access. **🟢 LOW** (working as designed; documented in table comment).

**facility_id is server-injected, not trusted from the request.** Confirmed across the mutating surface:
- The offline write path `src/app/api/offline-sync/route.ts:97,110,121,…` always passes `profile.facility_id` (resolved from the authenticated session at line 50-53) into every replay handler; the queued `payload` never supplies facility_id.
- Three server actions read `facility_id` from `formData`, and all three correctly pin non-super-admins to their profile facility and reject mismatches:
  - `src/app/admin/employees/actions.ts:160-194` (`resolveFacilityIdFromForm`) — non-super → profile facility, ignores form value; super → form value validated to exist.
  - `src/app/admin/facility-documents/actions.ts:51-74` (`resolveFacility`) — same pattern; mismatched id rejected, not coerced.
  - `src/app/admin/super-admin/actions.ts:231-258` (`setFacilityActive`) — gated by `requireSuperAdmin()`; UUID-validated + existence-checked.
- The `resolveFacility()` helper convention (refrigeration, retention, incident-reports, etc.) is used consistently across admin modules.

No Route Handler or server action was found that trusts a body/form `facility_id` from a non-super-admin to scope a write.

## 1B — Role enforcement

**Request-layer:** `src/proxy.ts` → `updateSession()` (`src/lib/supabase/session.ts:11-66`) refreshes the auth cookie and redirects unauthenticated users hitting `/admin`, `/reports`, `/dashboard`, `/account` to `/login` (lines 9, 49-55). No logic is inserted between `createServerClient` and `getUser()` (heeds the warning). This is coarse auth only; fine-grained role checks live server-side in layouts/actions (correct design).

**Admin guard:** `src/lib/auth/require-admin.ts` — checks `is_active` first (deactivated super admins denied, line 32), then `is_super_admin`, then an enabled `admin/admin` `user_permissions` row scoped to the user's facility (lines 44-59), then a fallback active admin-tier employee row (lines 68-79). Redirects to `/forbidden` otherwise. Applied in `src/app/admin/layout.tsx:15`.

**Super-admin-only paths** use a distinct guard, defended in depth:
- `src/app/admin/super-admin/page.tsx:24-28` — `requireAdmin()` then explicit `is_super_admin` redirect.
- `src/app/admin/super-admin/actions.ts:18-25` (`requireSuperAdmin`) gates `setSuperAdmin`, `setFacilityActive`, invite-health, etc.
- `src/app/admin/facility/actions.ts:90` — local `requireSuperAdmin` on facility CRUD.
Lower tiers cannot reach these.

**Permission gate (module/action):** `src/lib/permissions/check.ts` `currentUserCan()` wraps the `current_user_has_permission` RPC and fails closed on error. Used by every offline replay handler (`/api/offline-sync` lines 266, 353, 451, 637, …) before persisting.

### C1 — Role-assignment privilege escalation ✅ CLOSED
`src/lib/permissions/role-assignment-core.ts:28-37` (`canAssignRoleLevel`) — non-super callers may only assign a role strictly *below* their facility floor (`level > effectiveFloor`); unknown target → top-rank (deny); floor defaults to ADMIN_TIER_LEVEL(1) when unresolved, so a non-super can never mint admin(1)/super_admin(0). Enforced via `assertCanAssignRole` (`role-assignment.ts:51-79`) wired into `createEmployee` (`src/app/admin/employees/actions.ts:217-223`), `updateEmployee`, and the bulk path. Floor is resolved **per target facility** (`callerHierarchyFloor`, lines 23-43). Covered by `role-assignment-core.test.ts`.

### C2 — Permission-matrix self-grant of Admin Center ✅ CLOSED
`src/app/admin/permissions/user-permission-actions.ts` — `isAdminConsoleGrant()` (lines 44-46) blocks a non-super-admin from enabling `admin/admin` across all three write paths: `upsertUserPermission` (lines 72-77 facility + admin-grant guard), `applyPresetToUser` (lines 131-132 forces admin/admin false in presets), `bulkImportUserPermissionsCsv` (lines 224-235 skips cross-facility and admin-grant rows; blank `enabled` never defaults to grant, lines 209-213). RLS backstops cross-facility; this intra-facility escalation is caught in app code as intended.

## 1C — Input validation (Zod adoption)

Roughly **~5 of 45** mutating server-action/route files import Zod (≈ 5 of ~294 exported async actions touch Zod directly). Zod is concentrated in CSV/bulk-import validators and the one API route:
- `src/app/api/offline-sync/route.ts:36-65` — strong Zod body schema + `safeParse`, 400 on failure (the only public write endpoint; well-validated).
- `src/lib/account/schema.ts`, `src/components/admin/bulk-upload/{validate,types}.ts`, `admin/scheduling/_lib/grid-actions.ts`, and the air-quality/ice-ops/accident/daily import parsers.

The remaining ~40 server-action files do **not** use Zod; they validate via hand-rolled parsers (`parseFormInput`, `nonEmpty`, UUID regexes, `isModuleName`/`isUserAction` guards, numeric/time range checks in the replay handlers). Validation is present and generally sound, but inconsistent and ad-hoc. **🟡 MEDIUM** — recommend standardizing mutating server actions on a shared Zod (or equivalent) schema layer for consistency and to reduce the chance a future action ships under-validated; not a live exploit given DB CHECK constraints + RLS backstop.

## 1D — Secrets

- `SUPABASE_SERVICE_ROLE_KEY` is **server-only**: read exclusively via `process.env` in server contexts (`src/lib/supabase/admin.ts` carries `import "server-only"` at line 1; cron routes; `super-admin/actions.ts`; `invite-employee.ts`). **Never** exposed via `NEXT_PUBLIC_*`. ✅
- No hardcoded JWT/secret keys. The `eyJ` matches are format-validation regexes/comments in `src/lib/supabase/admin.ts` (lines 42-48, 200), not literals. ✅
- `.gitignore:34-41` ignores `.env`, `.env.local`, `.env.*`, with `!.env.example` whitelisted. `git ls-files` shows only `.env.example` tracked. ✅
- Cron routes (`src/app/api/cron/*`) authenticate with `CRON_SECRET` via `timingSafeEqual` (`run-retention-purge/route.ts:40-53`); return 503 if unset, 401 if mismatched. ✅

### Supabase security advisor (type=security) — 54 lints, 0 ERROR

- **🟡 MEDIUM — Leaked-password protection DISABLED** (`auth_leaked_password_protection`, WARN). Supabase Auth HaveIBeenPwned check is off; enable in Auth settings. Production-readiness gap.
- **🟡 MEDIUM — 48 `*_security_definer_function_executable` (WARN), incl. 4 anon-executable.** `current_user_id`, `is_super_admin`, `has_module_access`, `create_employee_complete`, `dispatch_rules_for_submission`, `seed_default_facility_modules`, etc. run as SECURITY DEFINER and are EXECUTE-able by `authenticated` (4 by `anon`: `check_rate_limit`, `enforce_incident_witnesses_cap`, `seed_default_facility_modules`, `tg_seed_facility_modules`). Most are intentional permission/trigger helpers that re-derive identity from `auth.uid()` internally, so direct calls don't grant escalation — BUT `seed_default_facility_modules(p_facility_id)` / `tg_seed_facility_modules` being anon/authenticated-callable as DEFINER warrants a manual review of whether an arbitrary caller can seed/alter modules for a facility they don't own. Recommend `REVOKE EXECUTE … FROM anon, authenticated` on functions not meant to be RPC-called.
- **🟢 LOW — `function_search_path_mutable`** on `schedule_swap_set_expiry` (WARN) — set `search_path = ''`/explicit.
- **🟢 LOW — `extension_in_public`** for `citext` and `pg_trgm` (WARN) — move out of `public` schema.

## Findings ledger

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| F1 | 🟡 MEDIUM | Zod adoption inconsistent (~5/45 mutating action files); most actions hand-roll validation | `src/app/**/actions.ts` (e.g. `admin/employees/actions.ts`), vs `src/app/api/offline-sync/route.ts:36` |
| F2 | 🟡 MEDIUM | `seed_default_facility_modules` / `tg_seed_facility_modules` SECURITY DEFINER executable by anon/authenticated — verify caller-facility ownership | Supabase advisor; migration 144 |
| F3 | 🟡 MEDIUM | Auth leaked-password protection disabled | Supabase Auth config |
| F4 | 🟢 LOW | `information_requests_insert` policy `with check (true)` for anon; directly POST-able with bundled anon key | `supabase/migrations/00000000000088_information_requests.sql:49-51` |
| F5 | 🟢 LOW | `rate_limit_counters` RLS-enabled with no policy (deny-all; by design) | advisor `rls_enabled_no_policy` |
| F6 | 🟢 LOW | `function_search_path_mutable` on `schedule_swap_set_expiry` | advisor |
| F7 | 🟢 LOW | `citext` / `pg_trgm` extensions installed in `public` schema | advisor |
| F8 | 🟢 LOW | session.ts redirects authed users only off `/login`, not `/signup` (CLAUDE.md says both); cosmetic | `src/lib/supabase/session.ts:6,58` |

## Verdict

No CRITICAL security findings. RLS is universally enabled, facility_id is server-injected everywhere, the only `TRUE` policy is a deliberate length-capped public form, secrets hygiene is clean, and **both prior criticals C1 and C2 are verified closed in current code** (not just claimed in the remediation log). Remaining items are MEDIUM/LOW hardening: standardize input validation (Zod), tighten SECURITY DEFINER EXECUTE grants, and enable leaked-password protection.
