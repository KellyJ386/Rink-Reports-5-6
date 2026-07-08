# Phase 3 (ASK-FIRST) — RBAC / Auth TS fixes

(Log reconstructed by the orchestrator: the implementing agent's connection
dropped before it wrote this file. All items below were verified on disk —
combined `tsc --noEmit` is clean for src/, `pnpm test` 411/411, incl. the new
`redirect-safe.test.ts` (9 tests).)

### N-002 (MED) — Login honored, open-redirect-safe
- New pure helper `src/app/(auth)/login/redirect-safe.ts` — `isSafeRedirectPath()`
  accepts only single-leading-slash absolute paths; rejects `//host`, `/\host`,
  any `scheme:`, and control/whitespace chars. Unit-tested (`redirect-safe.test.ts`).
- `login/actions.ts:22,38` — reads `redirectTo` from FormData, `redirect(safe ?? "/dashboard")`.
- `login-form.tsx` / `login/page.tsx` — thread `redirectTo` through as a hidden field.

### D-08 (MED) — seedRolesForCurrentFacility no longer trusts client facility_id
- `src/app/admin/employees/actions.ts:162-193` — facility resolved from the
  caller's `profile.facility_id`; a supplied `facility_id` form value is
  validated (`if (facilityId && facilityId !== profile.facility_id) → error`),
  never used to widen scope. Restores the server-derived-facility invariant.

### C-02 (MED) — Ice-ops submit gated on enabled_operation_types
- `src/app/reports/ice-operations/actions.ts:73-92` — before insert, loads the
  facility's `enabled_operation_types` and rejects a submission whose
  `operationType` isn't enabled (typed error). Direct-action / direct-URL
  submits of disabled types are now blocked server-side, not just redirected.

### C-15 (LOW) — getIsAdmin matches requireAdmin
- `src/lib/auth/get-is-admin.ts` — now checks `is_super_admin` OR an enabled
  `user_permissions` admin/admin row OR an active admin-tier employee role — the
  same sources `requireAdmin` uses. Matrix-granted admins now see the Admin nav
  link / admin-gated UI (previously role-key-only).

### D-04 (LOW) — deleteEmployee scoped by (id, facility_id)
- `src/app/admin/employees/actions.ts:504-525` — resolves the row's facility and
  deletes by both id and facility_id (still super-admin gated). Belt-and-suspenders.

### D-05 (LOW) — ice-depth done/pdf explicit permission gate
- `src/app/reports/ice-depth/[layoutSlug]/done/pdf/route.ts` — adds
  `currentUserCan(supabase,"ice_depth","view")` in addition to RLS; fails closed
  if RLS ever regressed.

### D-06 (LOW) — scheduling actions explicit facility scope
- `src/app/reports/scheduling/actions.ts` — `deleteAvailability` /
  `acceptSwapRequest` SELECTs now add `.eq("facility_id", auth.employee.facility_id)`
  (RLS + ownership already covered; defense-in-depth).

### D-09 (LOW) — /admin/permissions explicit facility filter
- `src/app/admin/permissions/page.tsx` + `[userId]/page.tsx` — users queries
  add `.eq("facility_id", current.profile.facility_id)` for non-super-admins,
  and the [userId] page guards `userRow.facility_id !== current.profile.facility_id`.

### E-12 (LOW) — permission-matrix refreshes from server after save
- `src/app/admin/permissions/_components/permission-matrix.tsx` — calls
  `router.refresh()` after a successful save so the UI reflects persisted state
  rather than the client-computed preset matrix.

### D-02 — page gate NOT added (see revert note)
The facility-paperwork page gate was intentionally NOT added: `facility_documents`
is not a member of `MODULE_NAMES`, so `currentUserCan(...,"facility_documents",...)`
is not even type-valid, and — more importantly — the module has no matrix/seed
path to grant. This is the same reason migration 166 was reverted (see
`audit/fixes-migrations.md`). D-02 is deferred to a product decision.
