# Phase 0.4 — Modal & Dialog Inventory

| ID | Module | File:Line | Purpose | Open trigger | Close paths | Confirm wired? | Destructive confirm? | Status |
|---|---|---|---|---|---|---|---|---|
| M-001 | admin/employees | employees-client.tsx:367 | Delete employee | Delete → setPendingDelete | backdrop/Esc/Cancel (AlertDialog) | deleteEmployee | Yes | WIRED |
| M-002 | admin/employees | employees-client.tsx:399 | Deactivate employee | Deactivate btn | backdrop/Esc/Cancel | deactivateEmployee | reversible | WIRED |
| M-003 | admin/employees | employee-form.tsx:65 | Add/edit employee (Sheet) | Add/edit btn | backdrop/Esc/X | create/updateEmployee | n/a | WIRED |
| M-004 | admin/spaces | spaces-tab.tsx:215 | Delete space | Delete → window.confirm() | native | deleteFacilitySpace | **window.confirm** | SUSPECT |
| M-005 | admin/spaces | space-form.tsx:31 | Add/edit space (Sheet) | btn | backdrop/Esc/X | create/updateFacilitySpace | n/a | WIRED |
| M-006 | admin/roles | role-manager.tsx:236 | Deactivate role | Deactivate btn | backdrop/Esc/Cancel | handleDeactivate | reversible | WIRED |
| M-007 | admin/roles | role-manager.tsx:372 | Create role (Sheet) | New role | backdrop/Esc/Cancel | createRole | n/a | WIRED |
| M-008 | admin/roles | role-manager.tsx:474 | Edit role (Sheet) | Edit | backdrop/Esc/Cancel | renameRole/setRoleHierarchy | n/a | WIRED |
| M-009 | admin/lists | option-form.tsx:38 | Add/edit option (Sheet) | btn | backdrop/Esc/Cancel | create/updateOption | n/a | WIRED |
| M-010–M-012 | admin/incident-reports | type-form.tsx:31, activity-form.tsx:31, severity-form.tsx:31 | Type/activity/severity CRUD (Sheets) | btn | backdrop/Esc/Cancel | create/update actions | n/a | WIRED |
| M-013–M-015 | admin/daily-reports | area-form.tsx:31, item-form.tsx:36, template-form.tsx:33 | Area/item/template CRUD (Sheets) | btn | backdrop/Esc/Cancel | create/update actions | n/a | WIRED |
| M-016 | admin/accident-reports | dropdown-form.tsx:39 | Dropdown value CRUD (Sheet) | btn | backdrop/Esc/Cancel | create/updateDropdown | n/a | WIRED |
| M-017 | admin/departments | department-form.tsx:31 | Department CRUD (Sheet) | btn | backdrop/Esc/Cancel | create/updateDepartment | n/a | WIRED |
| M-018 | reports/incidents | submission-form.tsx:116 | Confirm incident submission | Submit → setConfirmOpen | Cancel/backdrop/Esc | submitIncidentReport | Yes | WIRED |
| M-019 | reports/accidents | submission-form.tsx:154 | Confirm accident submission | Submit → setConfirmOpen | Cancel/backdrop/Esc | submitAccidentReport | Yes | WIRED |
| M-020 | admin/ice-depth | session-detail.tsx:142 | Delete session (AlertDialog) | Delete | backdrop/Esc/Cancel | deleteIceDepthSession | Yes | WIRED |
| M-021 | admin/ice-depth | rinks-tab.tsx:85 | Delete rink | Delete → window.confirm() | native | deleteRink | **window.confirm** | SUSPECT |
| M-022 | admin/scheduling | templates-client.tsx:186 | Delete template | Delete → window.confirm() | native | deleteTemplate | **window.confirm** | SUSPECT |
| M-023 | admin/scheduling | job-areas-client.tsx:112 | Delete job area | Delete → window.confirm() | native | deleteJobArea | **window.confirm** | SUSPECT |
| M-024 | admin/retention | retention-row.tsx:207 | Manual purge confirm | Run purge → setConfirmPurge | Cancel/state | triggerManualPurge | Yes (warning) | WIRED |
| M-025 | shared/admin | bulk-upload-panel.tsx:59 | Bulk import (Sheet) | Bulk upload btn | backdrop/Esc/close-on-success | schema.onImport | n/a | WIRED |
| M-026 | admin/scheduling | publish-button.tsx:41 | Request publish (custom) | Request publish | Cancel/state | requestSchedulePublish | n/a | WIRED |
| M-027–M-028 | shells | app/mobile-sidebar.tsx, admin/mobile-sidebar.tsx | Nav drawers (Sheets) | Menu btn | backdrop/Esc/close | n/a | n/a | WIRED |
| M-029 | admin/employees | bulk/_components/bulk-add-client.tsx | Paste-from-spreadsheet (Sheet) | btn | backdrop/Esc/Cancel | onImport | n/a | WIRED |
| M-030 | admin/employees | [id]/_components/employee-detail.tsx | Delete from detail page | delete btn | — | — | — | VERIFY in Phase 1 |
| M-031 | admin/ice-depth | layout-editor.tsx | Point editor overlay | point click | — | — | n/a | VERIFY in Phase 1 |

## Counts
Total 31 · WIRED 25 · SUSPECT 4 · VERIFY 2

## Destructive actions using window.confirm() instead of a proper confirmation dialog
1. Delete facility space — src/app/admin/spaces/_components/spaces-tab.tsx:215
2. Delete rink — src/app/admin/ice-depth/_components/rinks-tab.tsx:85
3. Delete scheduling template — src/app/admin/scheduling/templates/_components/templates-client.tsx:186
4. Delete job area — src/app/admin/scheduling/job-areas/_components/job-areas-client.tsx:112

(These DO confirm — via native window.confirm — so no unconfirmed destructive actions found so far; the four are UX-consistency findings, not safety holes. Additional destructive buttons surfaced by the gap-fill pass — e.g. ice-operations setup-tab delete rink/equipment/item/fuel-type/template, facility-documents delete, communications delete reminder, incident-reports delete type/severity/activity, lists delete option, daily-reports delete area — need their confirmation state verified in Phase 1 Agent B.)
