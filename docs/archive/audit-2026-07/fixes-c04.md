# Phase 3 (C-04) — Wire incident types into the staff incident form

**Decision:** wire the orphaned `incident_types` config into the staff form as an
**optional** field and persist `incident_reports.incident_type_id` (nullable FK,
`on delete set null`), completing the already-built admin history type filter.
No migration / no types regen (column + FK already existed).

Optional throughout — no RequiredMark, no FieldError, no required validation;
mirrors nullable `activity_id`. **Empty selection persists NULL** (empty hidden
input → falsy `input.incident_type_id` → `resolvedIncidentTypeId` stays null →
insert/update writes `refs.resolvedIncidentTypeId || null`).

## Files (7)
1. `reports/incidents/page.tsx` — load active `incident_types` in the parallel
   query; pass `incidentTypes={map(id,name)}` to `<SubmissionForm>`.
2. `_components/submission-form.tsx` — `IncidentTypeOption` type; `incidentTypes`
   prop (+ destructured); `IncidentFormInitial.incidentTypeId`; `incidentTypeId`
   state; optional `<Select>` "Incident type" in the "What happened" grid
   (rendered only when types exist); hidden `input name="incident_type_id"`;
   `incident_type_id` in `buildPayload()` (offline); cleared in
   `resetForNextOfflineEntry()`.
3. `_lib/compute.ts` — `incident_type_id: string` on `IncidentInput`; parsed in
   `buildInputFromForm` (`get`) and `buildInputFromPayload` (`str`). No validation.
4. `_lib/submit.ts` — `resolveIncidentRefs` resolves `resolvedIncidentTypeId`
   (verifies same-facility + `is_active`, else typed error); added to
   `ResolvedRefs` + `persistIncident` refs type; written in the insert and the
   create change-log `after`. Create + offline replay both call `persistIncident`
   with the whole `refs`, so both paths persist it.
5. `[id]/page.tsx` (edit) — `incident_type_id` in the report select; load
   `incident_types`; pass prop; `incidentTypeId: report.incident_type_id ?? ""`.
6. `[id]/.../actions.ts` (update) — `incident_type_id` in fetched columns, the
   `.update({})`, and both `before`/`after` change-log diffs (validated via the
   shared resolver).
7. `_lib/compute.test.ts` — `incident_type_id: ""` added to the `validInput`
   fixture to satisfy the widened `IncidentInput`.

## Verification
`pnpm exec tsc --noEmit` → 0 src errors · `pnpm lint` → clean · `pnpm test` →
411/411. Runtime end-to-end (staff submit with a type → admin history filter
matches) is covered by Playwright spec `05-incidents-accidents` once
creds/environment are available (Phase 2 still deferred).

## Note (surfaced during implementation)
Two of these files (`page.tsx`, `submission-form.tsx` stubs) had been partially
applied by a sub-agent before a container restart; the orchestrator completed the
remaining edits by hand and fixed one missed prop-destructure that tsc caught.
