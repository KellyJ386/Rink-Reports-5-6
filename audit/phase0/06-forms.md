# Phase 0.3 — Form Inventory

| ID | Module | File:Line | Purpose | Validation | Submit handler | Success path | Error path | Status |
|---|---|---|---|---|---|---|---|---|
| F-001 | auth | login/login-form.tsx:18 | Login | server-side manual (email format/length) | loginAction | redirect /dashboard | error in state | WIRED |
| F-002 | auth | update-password-form.tsx:25 | Update password | server-side (min 8, match) | updatePasswordAction | redirect /dashboard | error in state | WIRED |
| F-003 | account | account-form.tsx:77 | Account profile (contact, address, emergency, SMS opt-in) | server-side Zod (accountProfileSchema) | updateAccountProfile | revalidatePath /account + toast | toast + inline field errors | WIRED |
| F-004 | reports/accidents | submission-form.tsx:200 | Submit accident report | server-side (validateFields in _lib/compute) | submitAccidentReport | redirect done | fieldErrors in state | WIRED |
| F-005 | reports/accidents | [id]/edit-form.tsx:100 | Edit accident report | server-side | updateAccidentReport | revalidate + toast | error in state | WIRED |
| F-006 | reports/daily | daily-report-console.tsx:73 | Submit daily report | server-side (buildInputFromForm) | submitDailyReportAction · offline: enqueueSubmission | redirect done | error in state | WIRED |
| F-007 | reports/air-quality | submission-form.tsx:95 | Submit air-quality readings | server-side | submitAirQualityReport · offline queue | redirect done | error + toast | WIRED |
| F-008 | reports/incidents | submission-form.tsx:115 | Submit incident report | server-side (validateIncidentInput) | submitIncidentReport · offline queue | redirect done | fieldErrors + toast | WIRED |
| F-009–F-012 | reports/ice-operations | ice-make / circle-check / edging / blade-change forms | Submit ice-op (4 types) | server-side | submitIceOperationsReport (bound per type) · offline queue | redirect done | error in state | WIRED |
| F-013 | reports/ice-depth | submission-form.tsx:88 | Submit depth session | server-side | submitIceDepthSession · offline queue | redirect done | error + toast | WIRED |
| F-014 | reports/refrigeration | submission-form.tsx:160 | Submit refrigeration log | server-side (buildInputFromForm) | submitRefrigerationReport · offline queue | redirect done | error + toast | WIRED |
| F-015 | reports/communications | compose-form.tsx:58 | Compose message | server-side | sendCommunicationsMessage · offline queue | toast | error + toast | WIRED |
| F-016 | reports/scheduling | availability-form.tsx:82 | Availability window | server-side (parseTime, overlap) | upsertAvailability · offline queue | close sheet | error + toast | WIRED |
| F-017 | reports/scheduling | time-off-form.tsx:48 | Time-off request | server-side | submitTimeOffRequest · offline queue | close sheet + toast | error + toast | WIRED |
| F-018 | admin/employees | employee-form.tsx:78 | Create/edit employee | server-side | createEmployee / updateEmployee | close sheet + revalidate | error + toast | WIRED |
| F-019 | admin/departments | department-form.tsx:77 | Create/edit department | server-side | createDepartment / updateDepartment | close sheet + revalidate | error msg | WIRED |
| F-020 | admin/facility | facility-form.tsx:100 | Create/edit facility | client on submit + server-side | createFacility / updateFacility | close + revalidate/redirect | fieldErrors | WIRED |
| F-021 | admin/spaces | space-form.tsx:79 | Create/edit space | server-side | createFacilitySpace / updateFacilitySpace | close sheet + revalidate | error msg | WIRED |
| F-022 | admin/lists | option-form.tsx:73 | Create/edit list option | server-side | createOption / updateOption | close sheet + revalidate | error msg | WIRED |
| F-023 | admin/exports | export-settings-form.tsx:48 | Export/PDF settings | server-side | saveExportSettings | revalidate + toast | error msg | WIRED |
| F-024–F-026 | admin/daily-reports | area-form.tsx:77, template-form.tsx:78, item-form.tsx:80 | Areas / templates / checklist items CRUD | server-side | createArea/updateArea, createTemplate/updateTemplate, createChecklistItem/updateChecklistItem | close sheet + revalidate | error msg | WIRED |
| F-027–F-028 | admin/incident-reports | type-form.tsx:77, severity-form.tsx:79 | Incident types / severities CRUD | server-side | createIncidentType/…, createSeverityLevel/… | close sheet + revalidate | error msg | WIRED |
| F-029 | admin/air-quality | settings-tab.tsx:64 | AQ settings | server-side | updateAirQualitySettings | revalidate + toast | toast | WIRED |
| F-030 | admin/air-quality | compliance-profile-panel.tsx:100 | Compliance profile config | server-side | saveComplianceProfileConfig | revalidate + toast | toast | WIRED |
| F-031 | admin/ice-depth | layout-editor.tsx:64 | Layout/point CRUD (multiple actions) | server-side per action | createPoint/updatePoint/deletePoint/movePoint/renumberPointsForLayout/setLayoutDefault/setLayoutActive/setLayoutRink/updateLayout/deleteLayout | revalidate + toast | toast | WIRED |
| F-032 | admin/scheduling | templates/template-form.tsx:54 | Scheduling template CRUD | server-side | createTemplate / updateTemplate (admin-core-actions) | close + toast | toast | WIRED |
| F-033 | admin/scheduling | send-reminders-form.tsx:38 | Send shift reminders | server-side (1–168 range) | sendShiftReminders | toast w/ count | error msg | WIRED |
| F-034 | admin/communications | templates-tab.tsx:55 | Communication template CRUD | server-side | createTemplate / updateTemplate | toast | toast | WIRED |
| F-035–F-036 | admin/retention | retention-row.tsx:25-33 | Retention setting / manual purge | server-side | upsertRetentionSetting / triggerManualPurge | toast (+count) | toast | WIRED |
| F-037 | admin/super-admin | facilities-panel.tsx:16 | Toggle facility active | server-side | setFacilityActive | revalidate | action result | WIRED |
| F-038 | splash | request-information.tsx:68 | Request info (public) | **client-side format check only** (API route does its own parsing + rate limit) | POST /api/information-requests | success msg + close | error msg from API | WIRED (server-validation depth → Phase 1 check) |

## Counts
Total 38 · server-side validation 37 · client-only 1 (F-038 — API route rate-limits; validation depth to be verified in Phase 1) · offline-queue-capable 11 (F-006–F-017 report submissions)
