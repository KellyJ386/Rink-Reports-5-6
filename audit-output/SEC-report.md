# Security Audit — Agent-SEC

RinkReports 5-6 platform. Audit-only run (no code/migration/repo edits except this report).
Supabase project audited: `bqbdgwlhbhabsibjgwmk` only.
Date: 2026-06-17.

## Summary (counts)

- 🔴 CRITICAL: **0**
- 🟡 WARNING: **5**
- 🟢 SUGGESTION: **4**

Headline: No ground-rule violations. facility_id is server-injected everywhere (including the
offline-sync replay path), no client-side mutations, no service-role key reachable from client
bundles, every user-facing table has RLS enabled with facility scoping, no AI/LLM imports, no tRPC,
no `as any`/`@ts-ignore`, and no photo upload anywhere — including the explicitly-prohibited Ice
Depth and Incident modules. The one material gap is the Zod input-validation rule (CHECK 4): the
codebase standard is hand-rolled validation, not Zod, so most mutating actions are 🟡 (per the rule's
own "manual checks → 🟡" grading, not 🔴).

---

## 🔴 CRITICAL Findings

None.

All five "automatic-critical" ground rules in scope passed:
- **GR1 facility_id never from client** — PASS (see CHECK 1).
- **GR3 no `as any` / `@ts-ignore`** — PASS (zero matches in `src/` outside the generated
  `src/types/database.ts`; whole-word `\bas any\b` search returned nothing).
- **GR4 no tRPC** — PASS (no `trpc`/`@trpc` anywhere).
- **GR5 no AI/LLM** — PASS (no `openai|anthropic|gpt-*|langchain|ollama|replicate|together|groq`
  in `package.json` or `src/`).
- **GR6 no photo upload in Ice Depth / Incident** — PASS (zero file-input / upload / FileReader /
  image / camera references under `src/app/reports/ice-depth` or `src/app/reports/incidents`).

---

## 🟡 WARNING Findings

### W1 — Zod input validation is the exception, not the rule (CHECK 4)
**Spec ground rule 2** ("all mutating server actions validate input with Zod; no ad-hoc validation")
is **not met** by the codebase standard. Of ~290 mutating server actions:
- **VALIDATED with Zod (~9):**
  - `src/app/account/_lib/actions.ts:26` `updateAccountProfile` → `parseAccountForm()` /
    `accountProfileSchema.safeParse()` (shared module `src/lib/account/schema.ts`).
  - `src/app/admin/scheduling/_lib/grid-actions.ts` — `createGridShift` (~:264), `updateGridShift`
    (~:330), `previewShiftWarnings` (~:423), `saveGridTemplate` (~:462), `deleteGridShift` (~:540),
    all `safeParse` a local `z.object` before write.
  - Bulk CSV import-spec actions re-validate each row via `<spec>.zodRow.safeParse`:
    `admin/ice-operations/actions.ts:653` & `:1227`, `admin/daily-reports/actions.ts:435`,
    `admin/air-quality/actions.ts:265`, `admin/accident-reports/actions.ts:74`.
- **PARTIAL/MANUAL (~270):** all staff report submit flows (`reports/*/actions.ts` + `_lib/submit.ts`)
  and almost all admin config CRUD use copy-pasted hand-rolled helpers (`nonEmpty`, `asInt`,
  `asNumber`, `SLUG_RE`, `UUID_RE`, `isSeverity`, `if (!x)` guards) instead of Zod.
- **NONE (~8):** `seed*` actions inserting hardcoded constants (no external input), plus
  `signOut` / `stopPreview` (no inputs) — low risk.

Per the audit rubric ("Manual checks / no validation → 🟡"), this is a single systemic WARNING, not
a critical. Recommended fix: introduce a shared Zod schema layer and convert the staff submit flows
first (highest untrusted-input surface), then admin CRUD; the import-spec `zodRow` and the scheduling
grid are good in-repo templates.

### W2 — `information_requests` allows unauthenticated INSERT (`WITH CHECK true`)
`pg_policies`: policy `information_requests_insert` (cmd INSERT, roles `{anon, authenticated}`,
`with_check = true`). This is the public lead/contact intake table (read/update/delete are all
`is_super_admin()`-gated, and the table has no facility_id requirement for a global intake form), so
this is intentional. But it is an unauthenticated, unbounded INSERT path — also flagged by the
Supabase security advisor (`rls_policy_always_true`, lint 0024). Recommended fix: confirm
`public.check_rate_limit()` is applied to this endpoint and add a length/shape `WITH CHECK` constraint
so anon callers cannot insert arbitrary oversized rows.

### W3 — Supabase security advisor: function `search_path` mutable + extensions in public
From `get_advisors(type=security)`:
- `function_search_path_mutable` (WARN): `public.schedule_swap_set_expiry` has a role-mutable
  `search_path`. Recommended fix: `ALTER FUNCTION ... SET search_path = public, pg_temp;` (most other
  functions already pin it).
- `extension_in_public` (WARN x2): `citext` and `pg_trgm` installed in `public`. Recommended:
  relocate to a dedicated `extensions` schema.

### W4 — Auth: leaked-password protection disabled
Advisor `auth_leaked_password_protection` (WARN): HaveIBeenPwned check is off. Recommended fix: enable
in Supabase Auth password settings.

### W5 — `rate_limit_counters` has RLS enabled but no policies (informational, by design)
Advisor `rls_enabled_no_policy` (INFO). This is intentional — the table is reachable only via the
`SECURITY DEFINER` `check_rate_limit()` function, and RLS-with-no-policy correctly denies all direct
anon/authenticated access. No change required; listed for completeness.

---

## 🟢 SUGGESTIONS

### S1 — Spec/reality role-model gap (expected per audit note)
The spec's five-tier hierarchy (super_admin → org_admin → facility_manager → supervisor → staff) does
not match the implemented model: the code uses a `user_permissions` / `role_permission_defaults`
model and retired `gm`/`supervisor` (migrations 55/58/87). Per the audit instructions this is graded
against the actual model (which is internally consistent), and flagged here as a documentation gap
rather than a defect. Recommended: update the spec to describe the permission-matrix model.

### S2 — Many `SECURITY DEFINER` functions executable by `authenticated`/`anon`
`get_advisors` lists ~40 `SECURITY DEFINER` functions with EXECUTE granted to `authenticated` (and a
couple to `anon`: `check_rate_limit`, `enforce_incident_witnesses_cap`). The vast majority are
expected — they are the RLS helper layer (`has_module_access`, `has_area_access`,
`current_facility_id`, `is_super_admin`, `is_facility_admin`, `current_user_*`, permission resolvers)
that the policies deliberately rely on, plus trigger functions (`audit_row_change`,
`enforce_incident_witnesses_cap`, `schedule_swap_set_expiry`). Nothing unexpected/rogue was found.
Suggestion: trigger-only functions (`audit_row_change`, `enforce_incident_witnesses_cap`,
`schedule_swap_set_expiry`) do not need to be in the PostgREST-exposed API surface — consider
`REVOKE EXECUTE ... FROM authenticated, anon` on those to shrink attack surface. Privileged mutators
(`purge_module_data`, `create_facility_with_roles`, `deactivate_role`, etc.) appear to do their own
internal authz checks; worth a one-time confirmation that each re-checks caller authority.

### S3 — Deprecated tables still present
`role_module_permission_defaults` (table comment: "DEPRECATED as of migration 77 … Drop after admin/
roles page is migrated") still exists. Dropping retired tables reduces confusion and surface. (CLAUDE.md
notes other legacy permission tables were already dropped in migration 99.)

### S4 — `/api/health` echoes env presence booleans
`src/app/api/health/route.ts:35-64` returns booleans for `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`RESEND_*` presence. The route is itself `CRON_SECRET`-gated for the detailed branch (`:43`), so this
is low risk, but confirm the env-presence detail block is never reachable unauthenticated.

---

## PASS checks

**CHECK 1 — facility_id injection: PASS (clean).**
Every write that sets `facility_id` derives it server-side. Verified across all `reports/*/actions.ts`
+ `_lib/submit.ts`, all `admin/**/actions.ts`, `account/_lib/actions.ts`, `lib/auth/invite-employee.ts`.
Highest-risk path `src/app/api/offline-sync/route.ts` does **not** trust the client-queued payload: it
rejects unless `profile.facility_id` exists and injects `profile.facility_id` into every replay handler
and the queue upsert (lines ~96–203); the payload's facility_id is never read. The only actions that
read a client-supplied facility id are super-admin cross-facility helpers
(`employees/actions.ts:143`, `employees/bulk/actions.ts:36`, `scheduling/job-areas/actions.ts:48`,
`facility-documents/actions.ts:51`, `roles/actions.ts:154`, `super-admin/actions.ts:237`), each of
which discards it for non-super-admins / re-validates against the session or `facilities` table — the
intended multi-tenant pattern, not a violation.

**CHECK 2 — Supabase client usage: PASS (clean).**
Three factories: `@/lib/supabase/server` (cookie/JWT-bound, server), `@/lib/supabase/client`
(`createBrowserClient`, anon, `"use client"` only), `@/lib/supabase/session` (proxy only), plus
`@/lib/supabase/admin` (service-role, `import "server-only"`, typed `createClient<Database>`).
- No mutating op uses the anon browser singleton: grep for `.insert/.update/.delete/.upsert` chained
  off a Supabase call in `**/*.tsx` and in `src/components` returned **zero** matches. All writes flow
  through server actions / route handlers.
- `SUPABASE_SERVICE_ROLE_KEY` is read only in server-only files: `src/lib/supabase/admin.ts`,
  `src/app/api/cron/*` (drain-notifications, send-communications, run-retention-purge,
  expire-scheduling — all `CRON_SECRET` timing-safe-gated), `src/app/api/health/route.ts`, and
  `src/app/admin/super-admin/actions.ts` (a server action gated by `requireSuperAdmin()`). It is
  **never** imported under `src/components/`. (Note: `super-admin/actions.ts` lives under `src/app/`
  but is a Server Action, not client code — it never ships to the browser; acceptable.)

**CHECK 3 — RLS via Supabase MCP: PASS (clean, with W2–W5 advisories).**
- `list_tables` (verbose flags): **every** user-facing table has `rls_enabled = true`. A
  `pg_class` query for `relrowsecurity = false` user tables returned **zero** rows.
- All INSERT/UPDATE/DELETE/ALL policies on tables with a `facility_id` column are facility-scoped
  (via `facility_id = current_facility_id()`, `has_module_access/has_area_access`, `is_super_admin()`,
  or `is_facility_admin()`). The query for unscoped mutating policies returned only three rows, all
  verified safe on inspection:
  - `notification_outbox_insert` (`WITH CHECK false`) and `notification_outbox_update`
    (`USING false / WITH CHECK false`) — clients can never write; only service-role cron drains it.
    Its SELECT is `is_super_admin() OR facility_id = current_facility_id()` (scoped).
  - `profile_audit_log_insert` — `WITH CHECK (edited_by = auth.uid() AND
    can_edit_user_profile(target_user_id))`; the helper enforces facility scoping.
- `information_requests` (no facility_id by design) → see W2.
- `get_advisors(type=security)` run; findings folded into W2/W3/W4/W5 and S2.

**CHECK 4 — Input validation: see W1** (the one substantive WARNING; graded 🟡 per rubric).

**CHECK 5 — Env var exposure: PASS (clean).**
`.env.example` contains no real values — `SUPABASE_SERVICE_ROLE_KEY=`, `CRON_SECRET=`,
`RESEND_*=` are blank; URL/anon are obvious placeholders (`https://your-project-ref.supabase.co`,
`your-anon-key-here`). Non-`NEXT_PUBLIC_` env reads under `src/app/` are confined to API route handlers
and the super-admin server action (all server-only) — no secret env read in a client component.

**CHECK 6 — No photo upload: PASS (clean).**
Zero file-input/upload/FileReader/image/camera references in `src/app/reports/ice-depth` or
`src/app/reports/incidents`. The only file uploads in the app are non-photo and outside restricted
modules: `admin/facility-documents/actions.ts` (policy/manual document library — service-role admin
client, facility-scoped storage path `${facilityId}/${docId}/...`, extension allowlist, 25 MB cap)
and CSV imports (`components/admin/bulk-upload/`, `admin/daily-reports/_components/area-access-tab.tsx`).
`@react-pdf/renderer` and `xlsx` exports are present and expected.

**CHECK 7 — No AI/LLM imports: PASS (clean).**
No `openai`, `anthropic`, `gpt-*`, `langchain`, `ollama`, `replicate`, `together`, or `groq` in
`package.json` or anywhere in `src/`.
