# RR56 launch runbook — Saturday regression/deploy + Sunday Tennity smoke test

The two-day go-live runbook for Rink Reports 5-6. Part 1 is the Saturday
regression pass + production deploy; Part 2 is the Sunday Tennity pilot smoke
test. Companion to [`LAUNCH-CHECKLIST.md`](./LAUNCH-CHECKLIST.md) and
[`DEPLOY.md`](./DEPLOY.md).

- **Repo:** `KellyJ386/Rink-Reports-5-6`
- **Supabase project:** `bqbdgwlhbhabsibjgwmk` (MCP only)
- **Never reference** the retired project: `KellyJ386/MFO-Rink-Reports-2-7` / `iusjthlsafqlsxcykmso`

> **Roles — read this first.** An earlier draft of this runbook referred to
> `org_admin`, `facility_manager`, and `supervisor`. **Those roles do not exist
> in this system.** The live model has four **system** roles plus per-facility
> **custom** roles (e.g. `driver`). Authorization is resolved through
> `user_permissions` (roles only seed permission defaults), so wherever this
> runbook says "as a &lt;role&gt; account", use the mapping below.
>
> | Runbook draft name | Use this live role | Notes |
> | --- | --- | --- |
> | `super_admin` | `super_admin` | unchanged |
> | `org_admin` | `admin` | no separate org tier; `gm` was folded into `admin` (migrations 58/87) |
> | `facility_manager` | `admin` | facility-scoped admin = the `admin` role |
> | `supervisor` | `manager` | `supervisor` was retired; `manager` is the mid tier |
> | `staff` | `staff` | unchanged |

---

## Part 1 — Saturday: regression + production deploy

### 1A — Regression pass

Run the final pre-launch regression (verification only — do not fix anything
without reporting first). Six checks:

1. **RLS coverage** — every `public` table has RLS enabled with ≥1 policy.
   Report any table with RLS disabled or zero policies. (`rate_limit_counters`
   is deny-all by design — see migration 180, which adds an explicit
   service-role policy so the linter is quiet.)
2. **Publish-lock retest** — a locked/published schedule must reject both the
   admin server-action edit and a direct RLS-scoped mutation; override roles
   (`admin`/`super_admin`, via the governed `scheduling_admin_*` RPCs) still
   succeed; unlocked (draft) schedules are unaffected.
3. **Role matrix** — for each live role (`super_admin`, `admin`, `manager`,
   `staff`, and any custom role in play) verify one representative read + write
   per module resolves to the expected allow/deny.
4. **Facility scoping** — no server action or Route Handler may trust a
   client-supplied `facility_id` for tenant scoping; it must be derived from the
   authenticated user. RLS `WITH CHECK (facility_id = current_facility_id())` is
   the DB backstop.
5. **Offline queue** — the pending queue (owned by the service worker
   `public/sw.js`; **not** a client-side Dexie store) drains on reconnect for
   Daily Reports, Ice Operations, and Refrigeration, and any server rejection
   surfaces to the user (failed queue item in `SyncStatusBadge` +
   `/reports/offline-queue`) rather than dropping silently.
6. **Build health** — clean install, `tsc --noEmit` (zero type errors),
   `pnpm lint`, `pnpm build`.

**Gate:** every 🔴 (critical) must pass before deploying. A 🟡 (fails loudly,
data safe) can ship with a logged follow-up.

_Last run: 2026-07-08 — all six PASS, zero 🔴. See the regression report for
the role matrix and the four 🟡 follow-ups (all addressed in migration 180,
`config.toml` HIBP, and this doc)._

### 1B — Deploy checklist (manual, browser)

1. **Vercel project identity** — confirm you're deploying the **5-6** project,
   and note which Vercel project currently serves the custom domain (verify the
   domain pointing, don't assume — the April 2-7/4-7 surprise).
2. **Env-var audit** — Vercel → Settings → Environment Variables, **Production**:
   - `NEXT_PUBLIC_SUPABASE_URL` must contain `bqbdgwlhbhabsibjgwmk`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` present
   - `SUPABASE_SERVICE_ROLE_KEY` present, **not** prefixed `NEXT_PUBLIC_`
   - no variable referencing the old project ref anywhere
3. **Migrations** — deploy-migrations workflow green; hosted migration count
   matches the repo (contiguous, all applied). _Migration 180 must be applied._
4. **Auth hardening** — confirm **leaked-password protection** is ON for the
   hosted project (Authentication → Sign In / Providers → Passwords). This is
   codified in `config.toml` (`password_hibp_enabled = true`) but SQL migrations
   do **not** carry auth config — apply via `supabase config push` or the
   dashboard toggle.
5. **Deploy** — promote to production; load the prod URL in a private window;
   confirm login, dashboard tiles, and monitoring lights render.
6. **Domain flip** (only if 1–5 are clean) — point the custom domain at the 5-6
   project. Keep the old project **dormant, not deleted**, until Sunday passes.

---

## Part 2 — Sunday: Tennity pilot smoke test

Run on **production**, as a real **`admin`** (facility-scoped admin) account,
ideally on the actual rink-side device — then again with WiFi off for the
offline drill.

### Morning open (~30 min)

1. **Daily Reports** — open today's report; enter and save each of the 10 tabs
   (Front Desk, Pro Shop, Custodial, Skate Sharpening, Concessions, Event Set
   Up, Learn to Skate, Public Skate, Locker Rooms, Building Services). Each tab
   saves independently.
2. **Refrigeration** — log one full compressor reading (suction/discharge/oil
   pressure, amps, oil temp, brine supply/return/flow, ice surface temp,
   condenser). Normal ranges display inline; an out-of-range value is flagged.
3. **Ice Operations** — log one Ice Cut and one Circle Check with an equipment
   type selected; operation types match Admin config.
4. **Ice Depth** — enter one reading set; confirm no photo field appears.

### Midday (~20 min)

5. **Air Quality** — enter one reading; jurisdiction thresholds are correct; an
   admin cannot loosen them below the regulatory floor (attempt in Admin — must
   refuse).
6. **Incident Reporting** — file one test incident end to end.
7. **Employee Scheduling** — create a shift, publish the schedule, then attempt
   to edit it as a **`manager`** account → must be blocked with the clean error.
   Unlock/override as the **`admin`** account → confirm that works.
8. **Pro Shop POS + Ice Rentals** — one test transaction; one rental booking.

### Offline drill (~15 min)

9. Kill WiFi. Enter a Daily Report tab entry and an Ice Op → UI shows
   queued/pending. Restore WiFi → both sync and appear in the DB (Admin or
   Supabase MCP). (Note: staff time-off / availability writes are intentionally
   **not** publish-lock gated — the lock guards admin shift edits only. Any
   server rejection still surfaces as a failed queue item, never a silent drop.)

### End of day

10. Submit/lock the daily report; locked tabs reject further edits.
11. **Admin Control Center** — toggle one module tile off/on; nav updates
    (driven by `facility_modules`, not hardcoded); monitoring lights reflect
    real status.

### Scoring

- Fails **silently** (data lost, no error) = 🔴 fix before staff touch it.
- Fails **loudly** (clear error, data safe) = 🟡 log it, judge severity.
- All 11 clean = pilot is live. Delete nothing for a week; keep the old Vercel
  project and a DB backup until Tennity runs 5 real operating days.
