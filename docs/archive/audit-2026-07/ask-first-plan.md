# Phase 3 — ASK-FIRST Change Plan (awaiting approval)

These touch auth / RBAC / RLS / facility_id / offline sync / migrations. Per the
rules of engagement, **nothing here is applied without your explicit approval.**
Each item lists the finding, the risk, and the exact proposed change. Approve
individually (e.g. "do D-01, E-02, N-002; hold the rest") or as a batch.

---

## HIGH

### D-01 — Facility admin can mint a cross-tenant super-admin  *(new migration)*
**Finding:** `guard_users_profile_update()` (migration 100) early-returns for
`is_facility_admin(old.facility_id)`, exempting facility admins from the
`is_super_admin` immutability check. With the `users_update` RLS policy, a
facility admin can raw-PostgREST set `is_super_admin=true` on any same-facility
user → org-wide super-admin. No UI exposes it; the DB boundary allows it.

**Proposed fix — new migration** `supabase/migrations/000000000001XX_fix_superadmin_immutability_guard.sql`:
Gate `is_super_admin` and `id` changes to super-admins ONLY, before the
facility-admin exemption; facility admins keep `is_active`/`facility_id` rights.

```sql
create or replace function public.guard_users_profile_update()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;                        -- service-role / migration flows
  end if;

  if public.is_super_admin() then
    return new;                        -- super admins may change anything
  end if;

  -- Only super admins may EVER grant/revoke super-admin or change a user id,
  -- regardless of facility-admin status.
  if new.id is distinct from old.id
     or new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'Only super admins may modify super-admin status'
      using errcode = '42501';
  end if;

  -- Facility admins may still change the remaining privileged columns
  -- (activate/deactivate, move facility) for users in their facility.
  if public.is_facility_admin(old.facility_id) then
    return new;
  end if;

  if new.is_active   is distinct from old.is_active
     or new.facility_id is distinct from old.facility_id then
    raise exception 'Not allowed to modify privileged account fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
```
**Plus** a regression assertion in `supabase/tests/rls_isolation.sql`: as a
facility **admin**, attempt `update users set is_super_admin=true` on a
same-facility user → must RAISE. (Harness currently only covers the manager
case.) No app/TS code changes needed. **Type regen:** not required (no schema
shape change).

---

### E-01 — Offline queue is origin-global, not user-keyed  *(offline + identity)*
**Finding:** `/api/offline-sync/route.ts:56-98` attributes replays to the
*current* session at flush time (incidents re-stamp reporter identity from
login); `AuthStateListener` clears the schedule cache but not the queue. Shared
kiosk: user A's queued report syncs as user B.

**Proposed fix (needs your nod on approach):** stamp each queued item with the
`auth.uid()` (and employee_id) of the user who created it, at enqueue time in
`enqueueSubmission()` / the SW record; on flush, `/api/offline-sync` must
**reject** (not silently re-attribute) any item whose stored owner ≠ the current
session user, surfacing it in the queue UI as "belongs to another user — sign in
as them to sync." Also clear/za the queue owner check in `AuthStateListener` on
user switch. This is the safest correctness fix; the alternative (auto-flush the
previous user's queue on logout before switching) is more complex and racy.
**Decision needed:** reject-on-mismatch (recommended) vs flush-on-logout.

---

### E-02 — No offline flush survives SW termination on Safari/iOS  *(offline)*
**Finding:** without Background Sync, nothing drains pending items after the SW
is killed: window `online` never messages the SW, `GET_QUEUE` doesn't drain,
backoff timers die with the SW, no UI flush button for pending-only items.

**Proposed fix:** (a) in `use-sync-queue.ts`, on `window` `online` event AND on
app foreground/visibilitychange, post a `FLUSH_QUEUE` message to the SW that
drains all `pending`+`failed` items (not just failed); (b) add a manual
"Sync now" button on `/reports/offline-queue` that triggers the same flush;
(c) keep Background Sync as the fast path where supported. No server changes.

---

## MEDIUM

### N-002 — Login ignores `redirectTo`  *(auth)*
`(auth)/login/actions.ts:33` always redirects to `/dashboard`, discarding the
`redirectTo` the proxy appended when it bounced an unauthenticated user.
**Fix:** read `redirectTo` from the submitted form/searchParams, validate it is
a **same-origin, path-only** value (must start with `/`, not `//` or a scheme),
then `redirect(safeRedirectTo ?? "/dashboard")`. Prevents open-redirect while
restoring deep-link-after-login. Small, self-contained; auth-adjacent so
ASK-FIRST.

### D-02 — `/reports/facility-paperwork` has no module-permission check  *(RBAC/RLS)*
Page relies on `requireUser` only; `facility_documents_select` RLS gates on
facility, so any active staff can list/download all facility documents.
**Fix (needs decision):** add a `currentUserCan("facility_documents","view")`
gate on the page + tighten the RLS SELECT policy to require module access
(mirrors other modules' `has_module_access`). **Decision needed:** is facility
paperwork intended to be all-staff-visible (then this is by-design, close it) or
permission-gated (then apply both gates)? A migration is involved if we tighten
RLS.

### D-08 — `seedRolesForCurrentFacility` trusts client `facilityId`  *(facility_id invariant)*
`admin/employees/actions.ts:538` upserts roles using a client-supplied
`facilityId` with no `=== profile.facility_id` check (only RLS stops cross-
facility seeding). The one admin write violating the server-derived-facility
invariant. **Fix:** derive facility_id server-side from the caller's
profile/employee row and ignore/validate the client arg (throw if mismatched).
TS-only, no migration.

### C-02 — Ice-ops submit ignores `enabled_operation_types`  *(submission gate)*
`reports/ice-operations/actions.ts:103-105` never checks the facility's enabled
operation types, so a disabled type is still submittable by calling the action
(or via a direct URL that the redirect would otherwise bounce). **Fix:** in the
submit action, verify the submitted `operationType` is in the facility's enabled
set (same source the tabs use) before insert; return a typed error otherwise.
ASK-FIRST because it changes what is accepted server-side.

### C-04 — `incident_types` is orphaned config  *(scope decision)*
Admin CRUD + history filter exist, but nothing ever writes
`incident_reports.incident_type_id`. **Decision needed:** wire the staff incident
form to capture & persist `incident_type_id` (feature completion), OR remove the
orphaned admin UI + filter (scope-out). I recommend **wire it** (the filter is
already built and expects it) — but this is a product call, not an auto-fix.

### D-03 — Facility admin can grant admin to peers  *(ratify)*
A facility admin can grant `admin/admin` permission or the admin role to any
facility user (create peer admins). This **matches** the CLAUDE.md permission
model. **No code change proposed** — flagged only for your explicit
ratification that this is intended. Confirm and I'll mark it accepted.

### E-03 — Claim-protocol crash window orphans a report  *(offline)*
Server death between claim upsert and persist leaves a `pending` row; the retry
gets `duplicate:true`, the SW deletes the item, report never persists.
**Fix:** make the claim+persist atomic (single transaction) OR have the
duplicate-check verify the row actually reached `synced`/was written before the
SW deletes the queue item; add a reconcile that re-drives `pending` rows older
than N minutes. Needs care — proposing the transactional approach.

### E-04 — Unknown moduleKey marked `synced` without writing  *(offline)*
`api/offline-sync/route.ts:211-233` marks items `synced` for an unknown
moduleKey without writing any table (latent silent drop). **Fix:** treat unknown
moduleKey as a hard error (status `failed` with a clear reason), never `synced`.
Small, safe once approved.

---

## LOW (ASK-FIRST bucket — grouped; approve to include in the batch)

- **C-15** `getIsAdmin` omits the `user_permissions` admin/admin check that
  `requireAdmin` accepts → matrix-granted admins can reach `/admin` but see no
  nav link. Fix: make `getIsAdmin` consult the same permission source as
  `requireAdmin`. *(auth-adjacent)*
- **C-03** Ice-depth fallback thresholds disagree 3 ways (DB 0.99/1.75 · staff
  1/1.5 · admin 1/2). **Decision needed:** which is canonical? I recommend the
  DB migration value as source of truth and aligning the two client constants to
  it — but since this affects low/high **alerting**, I will not guess. Tell me
  the intended thresholds.
- **D-04/D-05/D-06/D-09** RBAC defense-in-depth: add explicit facility filters /
  `currentUserCan` checks to `deleteEmployee`, ice-depth done/pdf,
  `deleteAvailability`/`acceptSwapRequest`, and `/admin/permissions` queries.
  All RLS-covered today; these are belt-and-suspenders. Low risk, batchable.
- **E-05** `genLocalId` non-crypto fallback violates the `uuid` column → 500s.
  Fix: always generate a valid UUID (crypto.randomUUID with a compliant
  fallback). **E-06** queue badge false-empty after hard reload
  (`controller===null`) — re-query on controllerchange. **E-07** classify
  permanently-doomed replays as `failed` (422-style) not transient 500s.
  **E-08** offline availability edit whose row was deleted marks synced despite
  0 rows — surface as failed. **E-09** call `navigator.storage.persist()` to
  reduce eviction risk. **E-12** permission-matrix preset apply should refresh
  from server after save.

---

## Not fixing (verified by-design / no action)
- 40 `window.confirm` sites (B-06): all wired + pending-guarded; native-confirm
  vs AlertDialog is consistency debt. The **staff/admin gaps** (B-01, B-05) are
  being fixed under AUTO; converting the other 38 native confirms to AlertDialog
  is optional polish — say the word to include it.
- C-06/C-10/C-11/C-13/C-14/C-16/C-17/C-18: hardcoded-vs-admin items that Agent C
  judged deliberate/documented (e.g. accidents severity mapping is unit-tested;
  daily-area cap 30 is documented-synced). Listed for awareness; no change unless
  you want them reconciled.
- N-003 not-found → /dashboard: harmless (middleware intercepts unauthed).
- B-07/B-08/E-11: INFO only.
