# Phase 8 Incident & Accident Reporting Audit
**Date:** 2026-06-20  
**Auditor:** Agent-INCIDENT  
**Grade: 81 / 100**

---

## Checklist Results

### 1. Separate Incident vs Accident form types — PASS
Two entirely separate routes, schemas, and form flows:
- `src/app/reports/incidents/` — flat card-based form with severity, activity, spaces, witnesses, ambulance_flag, persons_involved, follow_up_required.
- `src/app/reports/accidents/` — richer SectionCard/SectionHead layout with body diagram, injured-person fields, severity pills, medical attention, workers' comp.
No cross-contamination of types.

### 2. Interactive SVG body diagram with lateralized (left/right) independently-selectable regions — PASS
`src/components/staff/body-diagram/body-diagram.tsx` implements a full dual-view (front/back) SVG figure. Paired regions (`shoulders`, `upper_arms`, `lower_arms`, `elbows`, `wrists`, `hands`, `fingers`, `upper_legs`, `knees`, `lower_legs`, `ankles`, `feet`) render two independent `<g>` elements per laterality, each with its own `onClick` handler (`handlePairedClick`). Each tap cycles through `front → back → both → none` independently per side. An accessible list-based alternative (`<details>`) provides the same functionality for keyboard/screen-reader users. Selections serialize to `accident_body_part_selections` with a `laterality` column (migration 00000000000092). Diagram is present on both `SubmissionForm` (create) and `EditForm` (24h edit window). Read-only view (`ReadOnlyView`) renders the diagram with `readOnly={true}`. **Minor gap**: in the accessible list panel, the pressed-state buttons use hardcoded `border-red-600 bg-red-600/10 text-red-700` instead of semantic tokens — minor dark-mode consistency issue only, not functional.

### 3. NO photo feature; NO AI — PASS (confirmed absence)
Grep across `src/app/reports/incidents/**` and `src/app/reports/accidents/**` for `photo`, `camera`, `ai_`, `openai`, `anthropic`, `vision`, `image_url`, `upload.*image` returned zero matches. Neither module imports any vision, OCR, LLM, or file-upload library.

### 4. Incident types admin-configurable — PARTIAL FAIL
**Gap (Medium severity):** `incident_types` table exists and is queried in the admin history loader (`page.tsx:197`) for filter badges and report decoration, but there is **no CRUD UI tab** for it. The admin `TABS` constant is `["history", "severities", "activities"]` (`types.ts:64-70`) — there is no "Types" tab. The `actions.ts` file has zero server actions touching `incident_types`. Admins can only read existing type assignments; they cannot create, update, deactivate, or delete incident types from the UI. The `seed-defaults-card` component seeds only severities (comment in `actions.ts:246`: *"Incident types are retired; only severities are seeded"*). This is a deliberate regression from an earlier design but conflicts with the checklist requirement.

**Severities and Activities are fully CRUD**: create, update, toggle active, delete (with in-use guard), and bulk CSV import — all present in `actions.ts`.

### 5. Required fields — PASS WITH NOTE

**Date/time (`occurred_at`):** Required, `datetime-local` input, HTML `required` attribute, server-side validation in `validateIncidentInput` (compute.ts:193-197). Both modules validate this.

**Location (facility_spaces):** Required for incidents — client validation enforces at least one space OR an "Other" description (submission-form.tsx:210-215); server-side validation in `validateIncidentInput` (compute.ts:212-215); `resolveIncidentRefs` cross-checks against DB (submit.ts:102-107). Accidents use a location dropdown from `facility_spaces` (optional in form — `SelectField` has no `required` attribute — see gap below).

**Description:** Required with `required` HTML attribute and server validation in both modules.

**Parties involved:** `persons_involved` is optional (integer, nullable) — intentionally so per migration 145 (`persons_involved integer` with no NOT NULL). The form label reads "Number of people involved (optional)". This is correctly optional.

**Witnesses:** Optional section in both modules; incident form enforces name+contact if a witness is added (client validation submission-form.tsx:219-230).

**Immediate actions:** Labeled "(optional)" in the incident form (submission-form.tsx:594) and stored as nullable. **Note:** the checklist says "immediate action" is required — this is currently optional. If the spec truly requires it, this is a gap. However, the current behavior is intentional and documented. Flagged as low severity pending spec clarification.

**Reporter name/phone — REMOVED (commit 2f5e8a7):** Reporter identity is now server-injected from the authenticated user's profile (`resolveReporterIdentity` in submit.ts:40-53). No client field exists for these. This is correct per the "reporter can't spoof" design, and the data is still captured from `users.full_name` + `users.phone`. If any external spec still says "reporter contact required on form", the removal is the right architectural call (tied to login identity), not a defect.

### 6. Emergency fields + supervisor/manager notification flow — PASS
Migration 145 added `ambulance_flag`, `persons_involved`, `follow_up_required` to `incident_reports`. All three are:
- Wired to the incident submission form (submission-form.tsx:128-136, 369-676).
- Persisted in `persistIncident` (submit.ts:155-157).
- Displayed in the admin detail view (report-detail.tsx:157-167) and read-only staff view ([id]/page.tsx:200-214).

**Ambulance escalation:** When `ambulance_flag = true`, `persistIncident` inserts a `communication_alerts` row with `severity: "critical"` and `requires_acknowledgement: true` (submit.ts:240-256), then calls `dispatchRulesForSubmission` with `severity: "critical"` (submit.ts:262-271). This ensures critical escalation is separate from and higher-priority than the routine notification fan-out.

**Accident medical attention:** Parallel escalation for `triggers_alert = true` medical attention options (submit.ts:177-219).

### 7. Reports locked after staff submit; 24h edit window — PASS

**Incidents:** `isWindowOpen(report.edit_window_ends_at)` gates the edit form at the page level ([id]/page.tsx:39-42, 146). Only the report owner (`isOwner = report.employee_id === employeeRow?.id`) within the window can edit. Post-window, a read-only `Card` renders. Edit window is visible in the UI ("Editable until…" / countdown on accidents). The `updateIncidentReport` server action in `actions.ts` also checks `edit_window_ends_at` server-side (line 113).

**Accidents:** Same pattern — `canEdit = isOwner && editWindowOpen` ([id]/page.tsx:257-262). EditForm is shown within window, `ReadOnlyView` outside. 24h window enforced.

**Admin editing after window-close — GAP (Medium severity):** Neither the incident admin panel (`report-detail.tsx`) nor the accident admin panel (`/admin/accident-reports/_components/report-detail.tsx`) exposes an edit form for admins to correct reports after the 24h window. Admins can only add follow-up notes and change status. This means supervisor/admin correction of a locked report requires a direct DB operation. Whether this is intentional ("original reports are immutable" per the admin page header description) or a gap depends on the spec. The `PageHeader` description says *"Original reports are immutable."* — this is a deliberate design choice documented in-code, but conflicts with a literal reading of "editable only by supervisor+ (24h edit window for accidents)" if "supervisor+" implies they can edit past the window.

### 8. facility_id server-injected; RLS enforced; design compliance — PASS

**facility_id server-injection:** All inserts in `persistIncident` and `persistAccident` inject `facilityId` from the authenticated session (resolved via `requireUser()` → employee row → `facility_id`). No client-supplied `facility_id` is accepted.

**RLS:** Cross-facility isolation covered by `supabase/tests/rls_isolation.sql`. Incident severity/activity refs are validated against `facility_id` in `resolveIncidentRefs`. Admin queries all `.eq("facility_id", facilityId)`.

**Design compliance:** Both forms use the correct Supabase client (`@/lib/supabase/server` on server components/actions, `@/lib/supabase/client` absent from these modules entirely — they use server actions). No `middleware.ts` file touched.

**Offline/PWA:** Both modules use service worker queue (`enqueueSubmission` / `useSyncQueue`), not Dexie. Incident: explicit offline confirm flow (submission-form.tsx:293-308). Accident: `handleSubmit` intercepts form submit when offline (submission-form.tsx:322-335). Both replay through `/api/offline-sync` with identical payload shapes as online paths.

---

## Gaps Summary (by severity)

| # | Severity | Description | File:Line |
|---|----------|-------------|-----------|
| 1 | **Medium** | `incident_types` table has no CRUD admin UI; the "Types" tab is absent. Types can be viewed in filter/badges but not created, modified, or deactivated by admins. | `src/app/admin/incident-reports/types.ts:64` (TABS constant missing "types") |
| 2 | **Medium** | No supervisor/admin edit path for locked reports after 24h window. Admin panel is read-only + note/status only. Spec ambiguity ("original reports are immutable" vs "editable by supervisor+") should be resolved. | `src/app/admin/incident-reports/_components/report-detail.tsx:94` (comment confirms intentional) |
| 3 | **Low** | `immediate_actions` is optional in the incident form despite the checklist listing it as a required field. Currently labeled "(optional)" and stored nullable. | `src/app/reports/incidents/_components/submission-form.tsx:593-594` |
| 4 | **Low** | Accident `location` dropdown (from `facility_spaces`) has no `required` HTML attribute and no server-side validation enforcing a selection. A report can be submitted with no location. | `src/app/reports/accidents/_components/submission-form.tsx:599-615` (SelectField, no required) |
| 5 | **Cosmetic** | Body diagram accessible-list panel uses hardcoded `border-red-600 bg-red-600/10 text-red-700` for pressed state instead of semantic tokens, violating the "never hardcode colors" rule in CLAUDE.md. | `src/components/staff/body-diagram/body-diagram.tsx:696, 733` |

---

## Migration 145 Verification

Migration `00000000000145_incident_emergency_fields.sql` confirmed present and correct:
- `ambulance_flag boolean NOT NULL DEFAULT false` — added via `alter table ... add column if not exists`.
- `persons_involved integer` (nullable, CHECK `>= 0`) — correct.
- `follow_up_required boolean NOT NULL DEFAULT false` — added.
- All three columns are wired to the form, persist pipeline, admin detail view, and staff read-only view. Communication alert on `ambulance_flag = true` is implemented in `submit.ts:240-256`.

---

## Positive Findings

- Body diagram implementation is robust: front+back dual-view, full laterality, front/back/both/none per region, accessible list fallback, clear-all, legacy `arms`/`head_neck` backward compatibility, read-only mode for history views.
- Ambulance escalation (`communication_alerts` + `dispatchRulesForSubmission` with `severity: "critical"`) is correctly separated from the routine notification fan-out and implemented best-effort (never blocks report save).
- Reporter identity anti-spoofing: `resolveReporterIdentity` fetches from the auth session, payload parser explicitly ignores any client-supplied `reporter_name`/`reporter_phone`.
- Change log is append-only on both modules with full before/after snapshots.
- Workers' comp flow on accidents includes instruction display and acknowledgement checkbox gate (`submitDisabled = workersComp && !workersCompAck`).
- Offline queue implementation correctly uses service worker, not Dexie, matching the architecture spec.
- No photo, no AI — confirmed clean.
