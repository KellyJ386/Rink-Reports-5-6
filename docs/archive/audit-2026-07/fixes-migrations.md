# Migration fixes — Agent D (RBAC/Security)

Change log for the DB migrations implementing audit findings D-01 and D-02.
Nothing committed. Highest pre-existing migration was `00000000000164`.

## D-01 (HIGH) — Facility admin could mint a cross-tenant super-admin

**File:** `supabase/migrations/00000000000165_fix_superadmin_immutability_guard.sql`

`guard_users_profile_update()` (from migration `00000000000100`) early-returned
for **any** `is_facility_admin(old.facility_id)`, exempting facility admins from
the `is_super_admin` / `id` immutability check. Combined with the `users_update`
RLS policy (which lets a facility admin UPDATE any same-facility `users` row), a
facility admin could raw-PostgREST `update public.users set is_super_admin=true`
on any same-facility user (incl. themselves) → org-wide super-admin.

**Fix:** `create or replace function public.guard_users_profile_update()` with the
approved logic — the `id` / `is_super_admin` immutability check now runs and
raises for anyone who is not a super admin, **before** the facility-admin
exemption. Facility admins keep their rights over `is_active` / `facility_id`.
Preserved from migration 100: `security definer`, `set search_path = public,
pg_temp`, the `comment on function`, and
`revoke execute ... from public, anon, authenticated`.

**Trigger:** left untouched. `users_profile_update_guard` already binds to this
function name; `create or replace` keeps the binding. Neighbor migration 164 only
recreated its trigger because it changed the firing events (added INSERT) — not
the case here — so per neighbor style the trigger is NOT recreated.

## D-02 (MEDIUM, RLS half) — facility_documents readable by all staff

> **⛔ REVERTED by the orchestrator (migration 166 deleted; harness D-02 parts
> removed). Reason:** `facility_documents` is NOT a member of `MODULE_NAMES`
> (`src/lib/permissions/actions.ts`), is not seeded into any role defaults, and
> is not exposed in the permission matrix. `has_module_access('facility_documents')`
> requires an explicit `user_permissions` row (module_name='facility_documents',
> action='view') that **no admin UI can create** — so the gate would have
> permanently locked every non-super-admin out of facility documents with no way
> to grant access back. D-02 needs a product decision (make paperwork a
> first-class permissioned module, vs. accept all-staff-visible) before any RLS
> change. The description below documents the reverted attempt for reference.

**File (deleted):** `supabase/migrations/00000000000166_facility_documents_module_gate.sql`

The `facility_documents_select` policy (migration `00000000000085`) gated on
facility only, so any active staff member could list + get signed download URLs
for **all** facility documents. Redefined SELECT to also require
`has_module_access('facility_documents')`, mirroring the refrigeration /
incident_reports report-table SELECT shape:
`is_super_admin() OR (facility_id = current_facility_id() AND has_module_access('facility_documents'))`.
Super-admin bypass preserved; the admin write policies
(`facility_documents_insert/_update/_delete`) are unchanged.

### ⚠️ ACCESS-CHANGING — ACTION REQUIRED (surface to orchestrator)

This TIGHTENS access. Existing staff who previously relied on the facility-only
gate will **lose** read access to facility documents until granted a
`user_permissions` row with `module_name='facility_documents'`, `action='view'`,
`enabled=true` in their facility. A backfill / provisioning step is needed for
anyone who should retain access (via the permissions matrix or a data migration).
A clear warning comment is at the top of the migration file.

## RLS regression harness — `supabase/tests/rls_isolation.sql`

All changes stay inside the single existing `begin … rollback` transaction.

1. **Fixture grant (D-02 support):** added `'facility_documents'` to Alice's
   base `user_permissions` view/submit seed list so the pre-existing positive
   test ("alice can browse her own facility's documents") still passes under the
   new module gate. Mona (manager, facility A) deliberately gets NO
   facility_documents grant.

2. **D-02 negative assertion** (added in the profile-management block, acting as
   Mona): a same-facility manager **without** `facility_documents` access must
   read **0** documents in her own facility:
   `paperwork/D-02: manager without facility_documents access CANNOT SELECT own-facility documents`.

3. **D-01 assertions** (added at end, after the facility-admin grant block):
   introduced a genuine facility-admin actor **Fred** (facility A, fresh identity
   — the existing `Dave` id is already used as a staff-role refrigeration actor,
   so a new id avoids collision) with an `admin`-role employees row (so
   `current_user_role()='admin'` lets his UPDATE pass the `users_update` RLS
   admin-branch and actually reach the trigger, instead of being filtered to zero
   rows) **and** an `admin/admin` `user_permissions` grant (so
   `is_facility_admin()` is true and the OLD guard would have exempted him).
   Assertions:
   - control: `D-01: facility admin CAN perform an allowed privileged users update (control)` (no-op `is_active` write, proves RLS is open to him)
   - `D-01: facility admin CANNOT escalate is_super_admin on a same-facility user` (target Mona)
   - `D-01: facility admin CANNOT self-escalate is_super_admin` (target Fred)

## Types regeneration

**Not required.** Both migrations change only a function body (D-01) and an RLS
policy predicate (D-02) — no table/column/enum shape changes — so
`src/types/database.ts` does not need regeneration.

## Referenced-function verification

Grepped `supabase/migrations/` for each function called by the new SQL. All exist:

| Function | Defined in |
|---|---|
| `public.is_super_admin()` | `00000000000003_helper_functions.sql` |
| `public.is_facility_admin(uuid)` | `00000000000078_user_permissions_rls_recursion_fix.sql` |
| `public.current_facility_id()` | `00000000000003_helper_functions.sql` |
| `public.has_module_access(text)` | defined `00000000000003`, redefined to read `user_permissions` in `00000000000091_unify_permission_helpers.sql` |
| `public.current_user_role()` (harness) | `00000000000003_helper_functions.sql` |

**No referenced function could not be verified.**

## Verification note

Local psql was unavailable here, so no live run. Each statement was re-read for
syntax, and the harness actor plumbing was checked against the existing fixtures
(Alice = staff facility A, Mona = manager facility A, Bob = staff facility B) to
ensure the new assertions actually reach the trigger/policy under test rather
than being masked by RLS row-filtering (hence the dedicated `admin`-role Dave
actor and the control assertion for D-01).
