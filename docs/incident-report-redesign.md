# Incident Report Redesign — Spec

Status: **Draft for review** · Owner: Kelly Johnson · Branch: `claude/elegant-wright-LuGGo`

This document specifies the redesigned **Incident Report** (staff submission +
admin management). It is the agreed output of the requirements conversation; no
code has been written yet. Decisions marked **OPEN** still need a call before
implementation.

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
| Field | Type | Rules |
|---|---|---|
| **Name** | text | Auto-filled from the logged-in user; editable. **Required.** |
| **Phone** | tel | **Required.** |

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
"Add another witness" button; **max 250**. A witness block is validated only
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
- **Facility Spaces** tab — **NEW.** CRUD on the facility-scoped spaces list.
- **Activities** tab — **NEW.** CRUD on the incident activity list.
- **Incident Types** tab — already exists; field is removed from the staff form.
  See OPEN-3 for whether to retire the tab.
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
RLS: SELECT for same-facility module users; write for module admins. (Mirror
`incident_types` policies.) See OPEN-2 on whether this should be a shared
facility-level list rather than incident-scoped.

**`incident_report_spaces`** — join (report ↔ space, multi-select).
```
id uuid pk
facility_id uuid not null → facilities
incident_id uuid not null → incident_reports (on delete cascade)
space_id uuid not null → facility_spaces (on delete restrict)
unique (incident_id, space_id)
```

**`incident_activities`** — admin-managed activity list (see OPEN-1).
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
sort_order int not null default 0  (0..249)
created_at / updated_at
unique (incident_id, sort_order)
```
Cap-to-250 enforced via a BEFORE INSERT trigger (mirror
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
  existing rows and history remain valid (see OPEN-3 / OPEN-4).
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

## 6. Open decisions

- **OPEN-1 — Activity dropdown source.** Accidents already have an `activity`
  category in `accident_dropdowns`. Reusing it couples Incidents to the Accident
  module's data/permissions. **Recommendation:** create an incident-scoped
  `incident_activities` table so the Incident admin owns its list. Confirm, or
  prefer reusing `accident_dropdowns`.
- **OPEN-2 — Facility Spaces scope.** Incident-scoped, or a **shared
  facility-level** list (so Accidents' `location` and future modules can reuse
  it)? **Recommendation:** make it a shared `facility_spaces` list managed under
  the Facility admin area, surfaced as a tab in Incident admin too.
- **OPEN-3 — Incident Types retirement.** Field is removed from the staff form.
  Keep the admin tab + column for historical reports, or fully deprecate?
  **Recommendation:** keep column + hide/retire the tab; don't drop data.
- **OPEN-4 — Legacy `location` text.** Keep the column for old rows (recommended)
  vs. migrate existing values into the new spaces model.

---

## 7. Implementation order (once decisions are settled)

1. Migration(s): `facility_spaces` (+ seed), `incident_activities` (+ seed),
   `incident_report_spaces`, `incident_witnesses` (+ cap trigger),
   `incident_change_log`; alter `incident_reports`; update RLS.
2. `rls_isolation.sql` assertions.
3. Regenerate DB types.
4. Admin: Facility Spaces + Activities management; extend report detail.
5. Staff form rebuild + server action + offline-sync wiring.
6. Submitter within-window edit view.
