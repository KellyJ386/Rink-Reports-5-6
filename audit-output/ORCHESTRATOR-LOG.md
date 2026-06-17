# Orchestrator Log — RinkReports 5-6 Audit

**Run:** AUDIT-ONLY (no code changes, no migrations, no edits)
**Repo:** KellyJ386/Rink-Reports-5-6 · branch `claude/quirky-tesla-7z80dp`
**Supabase project:** `bqbdgwlhbhabsibjgwmk` — confirmed ACTIVE_HEALTHY (Postgres 17, us-east-1)
**Date:** 2026-06-17

## Step 1 — Orientation findings

### Tech stack (from package.json)
- **next** `16.2.9` (≥15 ✓)
- **react** `19.2.4`, **react-dom** `19.2.4`
- **react-big-calendar** `^1.20.0` ✓ (+ `@types/react-big-calendar`)
- **zustand** `^5.0.14` ✓
- **zod** `^4.4.3` ✓
- **@supabase/supabase-js** `^2.105.3` ✓ (+ `@supabase/ssr` `^0.10.2`)
- Does NOT contain: trpc ✓, openai ✓, anthropic ✓, prisma ✓
- Notable extras: `@react-pdf/renderer`, `xlsx`, `resend`, `posthog-js`, `libphonenumber-js`

### 🚩 RED FLAG #1 — No Dexie
The audit master prompt (Agent-OFFLINE, schema checks) assumes a **Dexie.js** offline layer.
**`dexie` is NOT a dependency and is not used anywhere in src/.** This repo's offline
architecture is **service-worker based**: `public/sw.js` owns the queue, the client talks to it
via `src/lib/offline/use-sync-queue.ts` (`enqueueSubmission`, `retryFailedSubmissions`), and the
SW POSTs to `/api/offline-sync` which upserts into the `offline_sync_queue` table
(`onConflict: "local_id"`). Agent-OFFLINE must audit THIS architecture, not Dexie. A "missing
Dexie" is NOT a bug — it is a stale assumption in the audit spec.

### 🚩 RED FLAG #2 — Role hierarchy mismatch
The audit spec asserts a five-tier hierarchy: `super_admin → org_admin → facility_manager →
supervisor → staff`. The codebase tells a different story: migrations
`00000000000058_drop_gm_from_admin_role_lists.sql`, `00000000000087_retire_gm_supervisor_roles.sql`,
and `00000000000055_consolidate_canonical_roles.sql` show `gm` and `supervisor` were **retired**.
CLAUDE.md describes `requireAdmin` allowing `role.key in (admin, gm, super_admin)`. The live role
seed (`00000000000005_seed_system_roles.sql` + consolidations) is the source of truth — agents must
grade against the ACTUAL role model, and flag the spec/reality gap rather than the code.

### 🚩 RED FLAG #3 — Table naming differs from spec
The audit spec invents table names (e.g. `user_profiles`, `daily_report_submissions`,
`ice_depth_readings`, `schedule_shifts`). The codebase uses a permission model centered on
`user_permissions` (per migration 91/99) and module-specific schemas. Agents must map spec→actual
tables via the live schema (Agent-SCHEMA owns the authoritative table list).

### Migrations
144 files, monotonic prefixes `00000000000001` … `00000000000143`.
NOTE: duplicate prefix `00000000000139` appears twice
(`_daily_report_rename_operational_to_daily.sql` and `_scheduling_expiry.sql`) — flagged for
Agent-SCHEMA / Agent-BUILD (CLAUDE.md says "one file per prefix — no duplicates").

### Modules present (src/app/reports + src/app/admin)
daily, incidents, accidents, ice-depth, ice-operations, refrigeration, air-quality,
communications, scheduling. The "Logbook" reference form is refrigeration.

### Live Supabase projects visible
- `bqbdgwlhbhabsibjgwmk` — "Rink Reports 5-6" (TARGET) ✓
- `iusjthlsafqlsxcykmso` — "Rink Reports by Max Facility" (DO NOT TOUCH — out of scope)

## Plan
- Wave 1 (parallel): Agent-SEC (opus), Agent-SCHEMA (opus), Agent-BUILD (haiku), Agent-OFFLINE (haiku)
- Wave 2 (parallel, after Wave 1): DAILY, ICEDEPTH, ICEOPS, REFRIG, AIR, INCIDENT, SCHED (sonnet),
  ADMIN (opus), CROSS (sonnet)
- Step 4: synthesize FINAL-AUDIT-REPORT.md
