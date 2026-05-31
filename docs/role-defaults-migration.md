# Scope: migrate the admin "Role defaults" UI off `role_module_permission_defaults`

**Status:** not started — scoping only. This is the one legacy permission table
the scale/hardening pass (migrations 96–99) deliberately did **not** drop,
because the deployed admin UI still reads and writes it. Finishing it is a
code-first change with a real UX decision, so it gets its own reviewed PR.

## Why it was left in place

Migration `00000000000099_drop_dead_legacy_permission_tables.sql` dropped
`module_permissions`, `department_module_permission_defaults`, and
`facility_module_permission_defaults` (zero code readers). It **kept**
`role_module_permission_defaults` because three deployed call sites still use it.

## The two models (the core of the work)

| | Legacy: `role_module_permission_defaults` | New: `role_permission_defaults` (migration 79) |
|---|---|---|
| Grain | one row per `(role_id, module_key)` | one row per `(role_id, module_name, action)` |
| Value | `permission_level` — 9-level enum `module_permission_level` (`none, view, submit, edit_own, edit_all, approve, publish, manage_settings, admin`) | `action` ∈ `user_action` (`view, submit, edit, admin`) + `enabled boolean` + `source` |
| Seeds users? | no (legacy/dead path) | **yes** — `role_permission_defaults_auto_seed` trigger seeds `user_permissions` on employee/role assignment; `apply_role_permission_defaults` / `seed_role_permission_defaults_for_facility` / `reapply_role_defaults_for_role` all read it |

`role_permission_defaults` is already the live source of truth (218 rows, RLS +
resolvers read it). The legacy table (30 rows) is a parallel, now-orphaned matrix
that only the admin Roles screen still edits — changes to it no longer affect
anyone's actual access.

**The UX decision:** the Roles admin screen presents a single dropdown per
`(role, module)` choosing one of 9 levels. The new model is a 4-checkbox grid
(`view / submit / edit / admin`) per `(role, module)`. Migrating means redesigning
that control and choosing a 9→4 mapping (e.g. `edit_own/edit_all/approve/publish/
manage_settings` all collapse to `edit`+`admin` flags). That mapping is a product
call and is the only non-mechanical part.

## Exact call sites to change (3)

1. **`src/app/admin/roles/page.tsx` (~L97–104)** — READ
   ```ts
   supabase.from("role_module_permission_defaults")
     .select("role_id, module_key, permission_level")
     .eq("facility_id", facilityId)
   ```
   → read `role_permission_defaults` (`role_id, module_name, action, enabled`) and
   reshape into the matrix the page renders. Update `DefaultsRow` type + the cell
   renderer to the checkbox grid.

2. **`src/app/admin/roles/actions.ts` (~L61–71)** — WRITE (`setRoleModulePermissionLevel`)
   ```ts
   supabase.from("role_module_permission_defaults")
     .upsert({ facility_id, role_id, module_key, permission_level: level },
             { onConflict: "role_id,module_key" })
   ```
   → write per-action rows to `role_permission_defaults`
   (`onConflict: "role_id,module_name,action"`), then call
   `reapply_role_defaults_for_role(p_facility_id, p_role_id)` so existing users'
   `user_permissions` pick up the change (today's legacy write reaches nobody).

3. **`src/app/admin/page.tsx` (~L124–128)** — COUNT (dashboard checklist)
   ```ts
   (supabase as any).from("role_module_permission_defaults")
     .select("*", { count: "exact", head: true })
     .eq("facility_id", facilityIdStr).neq("permission_level", "none")
   ```
   → count `role_permission_defaults` where `enabled = true` (drop the `as any`
   once types are regenerated).

## Plan

1. Decide the 9-level → (4-action × enabled) mapping (product sign-off).
2. Rework `roles/page.tsx` matrix → action-grid; update `roles/actions.ts` writer
   to `role_permission_defaults` + `reapply_role_defaults_for_role`.
3. Update the dashboard count in `admin/page.tsx`.
4. `pnpm lint && pnpm build`; add an `rls_isolation.sql` assertion that role
   defaults flow into `user_permissions`.
5. Final migration: `drop table public.role_module_permission_defaults cascade;`
   (only after 1–4 ship and verify). Regenerate `src/types/database.ts`.

Reversibility: steps 1–4 are code-only and revertible; step 5 is the lone
destructive step and should land alone.
