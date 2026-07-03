# Phase 0.2a-ii — Interactive Elements: Admin gap-fill pass (A2)

Covers modules missed by the first pass: departments, employees bulk/form, exports, facility-documents, ice-operations, incident-reports, lists, refrigeration (history), retention, roles, spaces*, daily-reports (areas), communications (reminders), ice-depth (layout editor, log). *spaces & refrigeration setup/settings & communications tabs completed in pass A3 (file 02c).

| ID | Module | File:Line | Element | Type | Handler | Status |
|---|---|---|---|---|---|---|
| A2-001–A2-002 | departments | department-form.tsx:151-156 | Cancel / Save-Create | Button | close sheet / form submit | WIRED |
| A2-003 | departments | departments-tab.tsx:77 | Add department | Button | openCreate() | WIRED |
| A2-004–A2-005 | departments | departments-tab.tsx:142-155 | Move up / Move down | Button | move(d, ±1) | WIRED |
| A2-006 | departments | departments-tab.tsx:176 | Edit | Button | openEdit(d) | WIRED |
| A2-007–A2-008 | departments | departments-tab.tsx:186-202 | Deactivate / Reactivate | Button | setDepartmentActive | WIRED |
| A2-009–A2-012 | employees-bulk | bulk-add-client.tsx:216-232 | Add row / Paste from spreadsheet / Download template / Clear all | Button | addRow / setPasteOpen / href CSV / clear | WIRED |
| A2-013 | employees-bulk | bulk-add-client.tsx:288 | Send invites switch | Switch | setSendInvites | WIRED |
| A2-014–A2-015 | employees-bulk | bulk-add-client.tsx:305-314 | Clear added / Add employees | Button | removeSucceeded / handleSubmit | WIRED |
| A2-016 | employees-bulk | bulk-add-client.tsx:464 | Remove row (per-row) | Button | onRemove | WIRED |
| A2-017 | employees-bulk | bulk-add-client.tsx:619 | Select/deselect area (per-row) | DropdownMenuItem | toggle(o.id) | WIRED |
| A2-018 | employees-bulk | bulk-add-client.tsx:659 | Add area | Button | submitCreate | WIRED |
| A2-019–A2-020 | employees-bulk | bulk-add-client.tsx:775-779 | Cancel paste / Import rows | Button | onOpenChange / onImport | WIRED |
| A2-021 | employees-form | employee-form.tsx:238 | Role select | Select | setRoleId | WIRED |
| A2-022 | employees-form | employee-form.tsx:316 | Toggle job area (per-row) | Button | toggleArea | WIRED |
| A2-023 | employees-form | employee-form.tsx:345 | Primary job area | Select | setPrimaryAreaId | WIRED |
| A2-024 | employees-form | employee-form.tsx:392 | Add new job area | Button | handleCreateArea | WIRED |
| A2-025 | employees-form | employee-form.tsx:464 | is_minor checkbox | Checkbox | setIsMinor | WIRED |
| A2-026–A2-027 | employees-form | employee-form.tsx:510-516 | Cancel / Save-Create | Button | close / form action | WIRED |
| A2-028 | employees | seed-roles-button.tsx:21 | Seed default roles | Button | seedRolesForCurrentFacility | WIRED |
| A2-029–A2-031 | exports | export-settings-form.tsx:115-149 | Paper size / date format / CSV delimiter | Select | setters | WIRED |
| A2-032–A2-035 | exports | export-settings-form.tsx:168-209 | Include facility/date/submitted-by; column visibility (per-module) | Checkbox | form fields | WIRED |
| A2-036 | exports | export-settings-form.tsx:235 | Save export settings | submit | saveExportSettings | WIRED |
| A2-037–A2-040 | exports | run-export-panel.tsx:105-150 | Module / format / from / to | Select/Input | setters | WIRED |
| A2-041 | exports | run-export-panel.tsx:158 | Download export | Button | download() → /api/exports | WIRED |
| A2-042–A2-044 | facility-documents | facility-documents-client.tsx:141-207 | Category select / files input / Upload | Select/Input/submit | handleSubmit | WIRED |
| A2-045–A2-047 | facility-documents | facility-documents-client.tsx:337-360 | Hide-Show / Edit / Delete document | Button | setDocumentActive / setEditing / deleteDocument | WIRED |
| A2-048–A2-050 | facility-documents | facility-documents-client.tsx:422-454 | Edit category / Save / Cancel | Select/submit/Button | updateDocument / onDone | WIRED |
| A2-051 | ice-operations | history-filters.tsx:100 | Toggle operation type (per-row) | Button | toggleOp | WIRED |
| A2-052–A2-058 | ice-operations | history-filters.tsx:121-238 | Employee/rink/equipment/failed selects, from/to, search | Select/Input | setParam | WIRED |
| A2-059 | ice-operations | history-filters.tsx:242 | Clear filters | Button | clearAll | WIRED |
| A2-060 | ice-operations | history-tab.tsx:247 | View submission (per-row) | Link | buildDetailHref | WIRED |
| A2-061–A2-064 | ice-operations | settings-tab.tsx:77-141 | Temp unit / alerts_enabled / severity / enabled op types (per-row) | Select/Checkbox | form fields | WIRED |
| A2-065 | ice-operations | settings-tab.tsx:154 | Save settings | submit | updateIceOperationsSettings | WIRED |
| A2-066 | ice-operations | submission-detail.tsx:177 | Add note | submit | addIceOperationsFollowupNote | WIRED |
| A2-067 | ice-operations | seed-defaults-card.tsx:41 | Seed defaults | Button | seedDefaultIceOperationsConfig | WIRED |
| A2-068–A2-072 | ice-operations | setup-tab.tsx:195-276 | Rink: edit/toggle/delete/save/add | Button/submit | updateRink / createRink / deleteRink | WIRED |
| A2-073–A2-077 | ice-operations | setup-tab.tsx:415-619 | Equipment: edit/toggle/delete/save/add | Button/submit | update/create/deleteEquipment | WIRED |
| A2-078 | ice-operations | setup-tab.tsx:655 | Bulk upload circle-check items | BulkUploadPanel | importCircleCheckItems | WIRED |
| A2-079–A2-085 | ice-operations | setup-tab.tsx:764-962 | Circle-check item: move ±/edit/toggle/delete/save/add | Button/submit | update/create/deleteCircleCheckItem | WIRED |
| A2-086–A2-090 | ice-operations | setup-tab.tsx:1039-1128 | Fuel type: edit/toggle/delete/save/add | Button/submit | update/create/deleteFuelType | WIRED |
| A2-091–A2-101 | ice-operations | setup-tab.tsx:1281-1601 | Circle-check template + items: edit/toggle/delete/save/add/bulk | Button/submit | update/create/deleteCircleCheckTemplate(+Item), importCircleCheckTemplateItems | WIRED |
| A2-102–A2-108 | incident-reports | activities-tab.tsx:87-225, activity-form.tsx:152-158 | Activities: seed/add/edit/deactivate/reactivate/delete + form Cancel/Save | Button/submit | seedIncidentActivities, setIncidentActivityActive, deleteIncidentActivity | WIRED |
| A2-111 | incident-reports | history-tab.tsx:212 | View report (per-row) | Link | buildDetailHref | WIRED |
| A2-112–A2-115 | incident-reports | history-filters.tsx:81-143 | Status/type/severity/employee selects | Select | setParam | WIRED |
| A2-116–A2-122 | incident-reports | seed-defaults-card.tsx:41, severities-tab.tsx:53-180 | Severities: seed/add/edit/deactivate/reactivate/delete | Button | setSeverityLevelActive, deleteSeverityLevel | WIRED |
| A2-123–A2-128 | incident-reports | types-tab.tsx:65-180 | Types: add/edit/deactivate/reactivate/delete | Button | setIncidentTypeActive, deleteIncidentType | WIRED |
| A2-129–A2-133 | lists | options-tab.tsx:76-184 | Options: add(×2)/edit/toggle/delete | Button | setOptionActive, deleteOption | WIRED |
| A2-134 | refrigeration | history-tab.tsx:72 | View report (per-row) | Link | buildDetailHref | WIRED |
| A2-135–A2-139 | retention | retention-row.tsx:79-187 | Edit / presets (per-option) / Save / Manual purge / Cancel | Button/submit | upsertRetentionSetting, triggerManualPurge | WIRED |
| A2-140–A2-144 | roles | role-manager.tsx:126-206 | New role / Reactivate / copy From / copy To / Copy permissions | Button/Select | handleCopy etc. | WIRED |
| A2-146–A2-151 | daily-reports | areas-tab.tsx:88-168 | Areas: add(×2, cap-guarded)/edit/move ±/delete | Button | move, deleteArea | WIRED |
| A2-152–A2-153 | communications | reminders-tab.tsx:128-135 | Toggle reminder / Delete reminder | Button | setReminderActive, deleteReminder | WIRED |
| A2-154–A2-159 | ice-depth | layout-editor.tsx:88-279 | Back / rename / toggle active / delete layout / rink select / make default | Link/Button/select | onDelete, onChangeRink, onMakeDefault | WIRED |
| A2-160–A2-162 | air-quality/log | send-log-button.tsx:36-63 | Send… / Send PDF / Cancel | Button/submit | sendAirQualityLog | WIRED |
| A2-163 | air-quality/log | print-button.tsx:11 | Print | Button | window.print() | WIRED |

## Counts (A2 pass)
Total 163 collapsed rows ≈ 185 elements · WIRED 185 · UNWIRED 0 · SUSPECT 0
