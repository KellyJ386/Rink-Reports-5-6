# Incident Report Redesign — Spec

Status: **Implemented** (all of §7 shipped on `claude/elegant-wright-LuGGo`) ·
Owner: Kelly Johnson

See §8 (As-built notes) for the decisions and deviations that landed during
implementation.

This document specifies the redesigned **Incident Report** (staff submission +
admin management). It is the agreed output of the requirements conversation; no
code has been written yet. All data-model decisions are resolved (see §6) — the
spec is ready to implement.

---

## 1. Summary

Rework the staff Incident Report into a richer, accidents-flavored intake while
keeping it a **distinct module from Accidents** (no Incident/Accident toggle —
this form is Incident-only). The form gains multi-space tagging, an activity
dropdown, repeatable witnesses, an immediate-actions field, a 24h editable
window with an audit trail, and offline-queue submission. Admin gains a place to
manage the new dropdown lists (Facility Spaces, Activities) alongside the
existing Severities.

The Accident Report flow is untouched.

---

## 2. Staff submission form

Route: `src/app/reports/incidents` (existing). Mirrors the "Logbook" card layout
convention (see `CLAUDE.md` → Report form design pattern).

### Header (global, not part of the submission)
Standard `PageHeader` meta-chip row: logged-in **name**, **facility**, current
**date**, **time**, and the shared `--°F` chip. All read-only context. The
`--°F` chip is the app-wide header element and stays as-is (incidents do not
record temperature).

### Reporter
There is **no Reporter box** in the form. The reporter is the **logged-in
user** (their name already appears in the app header): `reporter_name` is
derived server-side from the employee's first/last name on submit. **No phone
is collected** — `reporter_phone` is dropped from the form and stored `null`
(migration 106 made the column nullable; retained for legacy rows). See §8.

### When & Where
| Field | Type | Rules |
|---|---|---|
| **Date + Time** | two inputs, one stored `timestamptz` | Defaults to now. No bounds (matches accidents). Stored in `occurred_at`. |
| **Facility Space** | multi-select, searchable | One or more, from the admin-managed Facility Spaces list, scoped to the reporter's facility. **Required (min 1).** Includes an **"Other"** option that reveals a single shared free-text box. |

`location` free text is **removed** from the UI; replaced by Facility Spaces +
the "Other" free-text fallback.

### What Happened
| Field | Type | Rules |
|---|---|---|
| **Description** | textarea | **Required**, **hard cap 500 chars** with a live counter. |
| **Activity at the time** | dropdown | Admin-managed list. **Optional.** Includes **"Other" → free text**. |
| **Severity** | dropdown | **Required.** Reuses the existing `incident_severity_levels` list. |
| **Immediate actions taken** | textarea | Optional, no cap. |

**Removed:** Incident Type (the field disappears from the form) and Equipment.

### Witnesses (optional, repeatable)
"Add another witness" button; **max 3**. A witness block is validated only
once a name is entered.
| Field | Type | Rules |
|---|---|---|
| **Name** | text | Required *if the block is started*. |
| **Phone** | tel | At least one of Phone/Email required (per started block). |
| **Email** | email | At least one of Phone/Email required. Both allowed. |
| **Brief Statement** | textarea | Optional, no cap. |

No strict phone/email format validation — accept whatever is typed.
Stored with **separate `phone` and `email` columns** (intentionally diverges
from accidents' single `contact` column).

### Submission behavior
- Confirmation dialog before submit (immutable-after-window warning).
- **24h edit window** for the submitter (mirrors accidents); afterward
  admin-only. Every change written to an audit trail (`incident_change_log`).
- A visible **"Reported at"** timestamp (submission time) is shown on the report
  for transparency; it stays fixed across edits.
- Routed through the **offline-sync queue** (SW → `/api/offline-sync`), not a
  direct browser → Supabase write.

---

## 3. Admin module

Route: `src/app/admin/incident-reports` (existing). Admins need to manage the
dropdown lists that feed the staff form, plus view submissions.

- **Severities** tab — already exists (`incident_severity_levels`). Keep.
- **Facility Spaces** tab — **NEW.** CRUD on the shared `facility_spaces` list.
  The list is owned by the Facility admin area and surfaced here as a tab.
- **Activities** tab — **NEW.** CRUD on the incident activity list.
- **Incident Types** tab — **retired** (hidden); the column and existing data are
  kept, but the field is gone from the staff form.
- **History / report detail** — extend the existing detail view to render the
  new fields (spaces, activity, immediate actions, witnesses, reported-at,
  change-log trail).

---

## 4. Data model changes

Existing today (migration `00000000000008_incident_reports_schema.sql`):
`incident_types`, `incident_severity_levels`, `incident_reports`,
`incident_followup_notes`. Next free migration prefix: **`00000000000101`+**.

### New tables

**`facility_spaces`** — admin-managed, facility-scoped areas.
```
id uuid pk
facility_id uuid not null → facilities
name text not null
slug text not null
sort_order int not null default 0
is_active boolean not null default true
created_at / updated_at
unique (facility_id, slug)
```
Shared facility-wide list (not incident-scoped). RLS: SELECT for same-facility
users with access to a consuming module; write for facility/module admins.
(Mirror `incident_types` policies.)

**`incident_report_spaces`** — join (report ↔ space, multi-select).
```
id uuid pk
facility_id uuid not null → facilities
incident_id uuid not null → incident_reports (on delete cascade)
space_id uuid not null → facility_spaces (on delete restrict)
unique (incident_id, space_id)
```

**`incident_activities`** — incident-owned, admin-managed activity list.
```
id, facility_id, key, display_name, color?, sort_order, is_active, timestamps
unique (facility_id, key)
```

**`incident_witnesses`** — mirrors `accident_witnesses` but split contact.
```
id uuid pk
facility_id uuid not null → facilities
incident_id uuid not null → incident_reports (on delete cascade)
name text not null (length > 0)
phone text            -- at least one of phone/email enforced in app
email text
statement text
sort_order int not null default 0  (0..2)
created_at / updated_at
unique (incident_id, sort_order)
```
Cap-to-3 enforced via a BEFORE INSERT trigger (mirror
`enforce_accident_witnesses_cap`).

**`incident_change_log`** — append-only audit trail (mirror
`accident_change_log`): `action`, `before` jsonb, `after` jsonb, admin-visible,
no update/delete policies.

### Altered table: `incident_reports`
- **Add** `edit_window_ends_at timestamptz not null default (now() + interval '24 hours')`.
- **Add** `activity_id uuid references incident_activities(id) on delete set null` (nullable; activity is optional).
- **Add** `activity_other text` (free text when activity = "Other").
- **Add** `location_other text` (free text when a Facility Space = "Other").
- **Add** `immediate_actions text`.
- **Keep** `severity_level_id` (app requires it on submit).
- **Keep but stop populating** `incident_type_id` and `location` — retained so
  existing rows and history remain valid.
- **Update RLS:** the UPDATE policy currently allows admins only. Change to also
  allow the submitter to update their own row while `now() <= edit_window_ends_at`
  (mirror `accident_reports` UPDATE policy), and likewise gate
  `incident_witnesses` / `incident_report_spaces` writes on the parent's window.

### RLS regression coverage
Add assertions to `supabase/tests/rls_isolation.sql` for the new tables
(cross-facility isolation; submitter-within-window vs. admin write gates), per
`CLAUDE.md`.

---

## 5. Application wiring

- **`src/app/reports/incidents/actions.ts`** — extend `IncidentFieldName`, build
  the witnesses + spaces payloads (hidden `*_json` inputs, following the
  accidents `WitnessPayloadEntry` pattern), validate required fields + the
  per-witness "name needs a contact" rule, and write report + children +
  `create` change-log entry transactionally.
- **`submission-form.tsx`** — rebuild to the spec above (multi-select spaces with
  search + "Other", activity select with "Other", description counter,
  repeatable witnesses, immediate actions). Drop incident type + equipment.
- **Offline path** — route the submission through `useSyncQueue()` /
  `enqueueSubmission()` → `/api/offline-sync` rather than a direct write. The
  endpoint must learn the incident payload shape (report + spaces + witnesses).
- **Generated types** — regenerate `src/types/database.ts`; for any table not yet
  in the generated types, use the `as any` + eslint-disable pattern already used
  for `offline_sync_queue`.
- **Edit flow** — add a within-window edit view for the submitter (incidents have
  none today; accidents' edit form is the reference).

---

## 6. Resolved decisions

- **OPEN-1 — Activity dropdown source → NEW `incident_activities` table.** The
  Incident admin owns its own activity list, decoupled from the Accident module.
- **OPEN-2 — Facility Spaces scope → SHARED facility-level list.** `facility_spaces`
  is a facility-wide list managed under the **Facility admin** area and surfaced
  as a tab in Incident admin; Accidents and future modules may reuse it later.
- **OPEN-3 — Incident Types → KEEP column, RETIRE tab.** Field is removed from the
  staff form; `incident_type_id` and existing data are retained; the admin
  management tab is hidden/retired. No data dropped.
- **OPEN-4 — Legacy `location` text → KEEP for old rows.** New reports use
  Facility Spaces; the old free-text `location` column stays for historical rows
  and is no longer populated.

---

## 7. Implementation order (once decisions are settled)

1. ✅ Migration(s): `facility_spaces` (+ seed), `incident_activities` (+ seed),
   `incident_report_spaces`, `incident_witnesses` (+ cap trigger),
   `incident_change_log`; alter `incident_reports`; update RLS.
2. ✅ `rls_isolation.sql` assertions (the `INC:` block).
3. ✅ Regenerate DB types.
4. ✅ Admin: Facility Spaces + Activities management; extend report detail.
5. ✅ Staff form rebuild + server action (see As-built note on offline).
6. ✅ Submitter within-window edit view.

---

## 8. As-built notes & deviations

- **Offline submission — now actually works (incidents only).** Originally the
  app's offline story was inert: `/api/offline-sync` only *logged* to
  `offline_sync_queue`, nothing drained it into module tables, and no form even
  enqueued (ice-depth's "offline" was a server action that silently fails
  offline). Incidents now implement **both halves**:
  - `_lib/submit.ts` is a shared parse → validate → resolve → persist pipeline
    used by both the online server action and the offline replay route, so an
    offline report lands the same rows with the same checks.
  - For `moduleKey: "incident_reports"`, `/api/offline-sync` actually inserts the
    report (+ spaces + witnesses + change log + dispatch) on replay. Idempotent
    via the queue's unique `local_id` as a **claim token** (duplicate replay =
    no-op; a persist failure releases the claim so a later retry re-attempts).
    No new column was needed. Other modules keep the legacy log-only behaviour.
  - The form, when offline (create mode), enqueues the payload to the service
    worker and shows an inline "saved on this device" confirmation; online still
    uses the server action. Online submit/update mirror the **accidents server
    action** (report → spaces + witnesses → `create` change log, with
    cleanup-on-failure).

- **Witness cap = 3** (form, `incident_witnesses.sort_order 0..2`, and the cap
  trigger), per the final requirements call.

- **Facility-space picker** is built as searchable selectable chips (+ an
  "Other → free text" chip), since the repo has no combobox/command primitive.
  Functionally a searchable multi-select.

- **Incident Types retired and pruned.** The staff form no longer collects a
  type; the admin tab, its form/CRUD actions, and default-type seeding were
  removed. The `incident_type_id` column and the History tab's type
  display/filter are kept for legacy reports (OPEN-3).

- **Facility-space writes** (migration 105) allow `is_super_admin()` OR
  `is_facility_admin()` OR `has_module_admin_access('incident_reports')`, so an
  Incident Reports module admin can manage the spaces surfaced in the Incident
  admin tab. Cross-facility isolation is unchanged (writes still require
  `facility_id = current_facility_id()`); the SELECT policy is unchanged.

- **Reporter box removed (post-review change).** The form no longer collects a
  reporter name or phone. `reporter_name` is derived server-side from the
  logged-in employee (online action and offline replay both pass it to
  `persistIncident`); `reporter_phone` is dropped (migration 106 made the column
  nullable; admin/detail/read-only views no longer show it).

- **Migration version ledger.** Migrations 101–106 were applied to the live
  "Rink Reports 5-6" project via MCP to regenerate authoritative types, so the
  project recorded them under timestamp versions while the repo keeps the
  convention-required sequential prefixes (`00000000000101`–`106`). This is
  benign: every statement is idempotent
  (`create … if not exists`, `add column if not exists`, `create or replace`,
  `drop policy if exists … create`), so a normal `supabase db push` re-applies
  them safely. Optionally tidy with `supabase migration repair`. CI
  (`rls-isolation.yml`) is unaffected — it applies the repo files on a fresh DB.
