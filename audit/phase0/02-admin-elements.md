# Phase 0.2a — Interactive Elements: Admin (non-scheduling)

> Coverage note: first pass (A-xxx) covered accident-reports, air-quality, audit-log, communications (templates), daily-reports (templates), employees (list), facility, ice-depth (layouts), modules, permissions, super-admin, admin dashboard. A second gap-fill pass (A2-xxx, file 02b) covers departments, employees detail/bulk, exports, facility-documents, ice-operations, incident-reports, lists, refrigeration, retention, roles, spaces, and remaining components.

| ID | Module | File:Line | Element | Type | Handler | Destination | Status |
|---|---|---|---|---|---|---|---|
| A-001 | admin/_components | facility-switcher.tsx:48-54 | Select (facility) | select | onValueChange → onChange() | Dynamic ?facility= | WIRED |
| A-002 | accident-reports | dropdown-form.tsx:207-223 | Cancel button | button | onOpenChange(false) | N/A | WIRED |
| A-003 | accident-reports | dropdown-form.tsx:215-223 | Create/Save value | submit | createDropdown / updateDropdown | N/A | WIRED |
| A-004 | accident-reports | dropdowns-tab.tsx:101-102 | Add value manually | button | openCreate() | N/A | WIRED |
| A-005 | accident-reports | dropdowns-tab.tsx:104-108 | Bulk upload values | menu-item | onImported callback | N/A | WIRED |
| A-006 | accident-reports | dropdowns-tab.tsx:140-142 | Add category value | button | openCreate() | N/A | WIRED |
| A-007 | accident-reports | dropdowns-tab.tsx:226-233 | Edit (per-row) | button | openEdit(d) | N/A | WIRED |
| A-008 | accident-reports | dropdowns-tab.tsx:236-248 | Deactivate (per-row) | button | runRowAction(setDropdownActive) | N/A | WIRED |
| A-009 | accident-reports | dropdowns-tab.tsx:250-263 | Reactivate (per-row) | button | runRowAction(setDropdownActive) | N/A | WIRED |
| A-010 | accident-reports | dropdowns-tab.tsx:264-280 | Delete (per-row) | button | runRowAction(deleteDropdown) | N/A | WIRED |
| A-011 | accident-reports | dropdowns-tab.tsx:311-333 | Category nav link (per-row) | link | categoryHref(c) | /admin/accident-reports?tab=dropdowns&category={c} | WIRED |
| A-012–A-021 | accident-reports | history-filters.tsx:90-262 | History filters (from/to date, employee, severity, body part, location, activity, medical, WC selects; clear) | select/input/button | setParam(...) / clearAll() | N/A | WIRED |
| A-022 | accident-reports | history-tab.tsx:544-549 | View link (per-row) | link | buildDetailHref | /admin/accident-reports?tab=history&report={id} | WIRED |
| A-023 | accident-reports | report-detail.tsx:147 | Close | link | backHref | dynamic | WIRED |
| A-024 | accident-reports | report-detail.tsx:339-342 | Add note submit | submit | addAccidentFollowupNote | N/A | WIRED |
| A-025 | accident-reports | report-detail.tsx:390-396 | Show/Hide before/after | button | setOpen(!open) | N/A | WIRED |
| A-026 | accident-reports | seed-defaults-card.tsx:43-45 | Seed defaults | button | onSeed() | N/A | WIRED |
| A-027 | accident-reports | workers-comp-tab.tsx:73-76 | Save | submit | updateWorkersCompInstructions | N/A | WIRED |
| A-028 | accident-reports | page.tsx:86-89 | Go to Facility Settings | link | href | /admin/facility | WIRED |
| A-029 | accident-reports | page.tsx:125-130 | Manage locations | link | href | /admin/spaces | WIRED |
| A-030 | air-quality | compliance-profile-panel.tsx:104-115 | Profile select | select | setProfileId | N/A | WIRED |
| A-031–A-035 | air-quality | compliance-profile-panel.tsx:148-268 | Metric checkboxes, threshold overrides, escalation steps, submit/view role inputs (per-item) | checkbox/input/textarea | form inputs | N/A | WIRED |
| A-036 | air-quality | compliance-profile-panel.tsx:281-283 | Save compliance profile | submit | saveComplianceProfileConfig | N/A | WIRED |
| A-037 | air-quality | compliance-tab.tsx:63-73 | All jurisdictions | link | href | /admin/air-quality?tab=compliance | WIRED |
| A-038 | air-quality | compliance-tab.tsx:74-99 | Jurisdiction links (per-row) | link | href | dynamic | WIRED |
| A-039 | air-quality | compliance-tab.tsx:287-292 | Edit (rule row) | button | setEditing | N/A | WIRED |
| A-040 | air-quality | compliance-tab.tsx:294-301 | Deactivate/Activate (rule row) | button | onToggleActive() | N/A | WIRED |
| A-041 | air-quality | compliance-tab.tsx:302-309 | Delete (rule row) | button | onDelete() | N/A | WIRED |
| A-042 | air-quality | compliance-tab.tsx:384-386 | Save rule | submit | updateComplianceRule | N/A | WIRED |
| A-043 | air-quality | compliance-tab.tsx:220-222 | Add rule | submit | createComplianceRule | N/A | WIRED |
| A-044–A-052 | air-quality | history-filters.tsx:86-238 | History filters (location, equipment, reading type, employee, exceedance, dates, search, clear) | select/input/button | setParam(...) / clearAll() | N/A | WIRED |
| A-053 | air-quality | history-tab.tsx:115-120 | Printable monitoring log | link | logHref | /admin/air-quality/log | WIRED |
| A-054 | air-quality | history-tab.tsx:138-143 | Reset filters | link | href | /admin/air-quality?tab=history | WIRED |
| A-055 | air-quality | history-tab.tsx:233-238 | View link (per-row) | link | buildDetailHref | /admin/air-quality?tab=history&report={id} | WIRED |
| A-056–A-061 | audit-log | audit-log-filters.tsx:54-138 | Filters (action, entity type, actor, from/to, search) | select/input | update(...) | N/A | WIRED |
| A-062 | communications | templates-tab.tsx:105-110 | Edit (per-row) | button | setEditing | N/A | WIRED |
| A-063 | communications | templates-tab.tsx:112-119 | Deactivate/Activate (per-row) | button | onToggleActive() | N/A | WIRED |
| A-064 | communications | templates-tab.tsx:120-127 | Delete (per-row) | button | onDelete() | N/A | WIRED |
| A-065 | daily-reports | templates-tab.tsx:71-79 | Add template | button | setFormOpen(true) | N/A | WIRED |
| A-066 | daily-reports | templates-tab.tsx:103-110 | Add template (empty state) | button | setFormOpen(true) | N/A | WIRED |
| A-067 | daily-reports | templates-tab.tsx:158-166 | Edit (per-row) | button | setEditing + setFormOpen | N/A | WIRED |
| A-068 | daily-reports | templates-tab.tsx:171-183 | Deactivate (per-row) | button | runRowAction(setTemplateActive) | N/A | WIRED |
| A-069 | daily-reports | templates-tab.tsx:184-197 | Reactivate (per-row) | button | runRowAction(setTemplateActive) | N/A | WIRED |
| A-070 | employees | employees-client.tsx:140-154 | Status filter buttons (per-item) | button | setStatus(f.key) | N/A | WIRED |
| A-071 | employees | employees-client.tsx:161-163 | Bulk add | link | href | /admin/employees/bulk?facility={id} | WIRED |
| A-072 | employees | employees-client.tsx:164 | Add employee | button | openCreate() | N/A | WIRED |
| A-073 | employees | employees-client.tsx:227-231 | Employee name link (per-row) | link | href | /admin/employees/{id} | WIRED |
| A-074 | facility | facilities-table.tsx:82-91 | Manage employees (per-card) | link | href | /admin/employees?facility={id} | WIRED |
| A-075 | facility | facilities-table.tsx:87-91 | Edit facility (per-card) | link | href | /admin/facility?id={id} | WIRED |
| A-076 | facility | new-facility-button.tsx:23 | New Facility | button | setOpen(true) | N/A | WIRED |
| A-077 | facility | new-facility-button.tsx:34 | Modal backdrop dismiss | icon | setOpen(false) | N/A | WIRED |
| A-078 | ice-depth | layouts-tab.tsx:146-149 | Layout link (per-row) | link | href | /admin/ice-depth?tab=layouts&layout={id} | WIRED |
| A-079 | ice-depth | layouts-tab.tsx:186-200 | Active/Off toggle (per-row) | button | onToggleActive() | N/A | WIRED |
| A-080 | modules | module-toggles.tsx:52-57 | Module toggle switches (per-item) | toggle | toggle(key, next) | N/A | WIRED |
| A-081 | permissions | permission-matrix.tsx:100-111 | Preset buttons (per-item) | button | applyPreset(p.value) | N/A | WIRED |
| A-082 | permissions | permission-matrix.tsx:144-149 | Permission checkboxes (per-cell) | checkbox | toggle(m, a, value) | N/A | WIRED |
| A-083 | admin | page.tsx:544-554 | Checklist CTA links (per-item) | link | item.href | dynamic | WIRED |
| A-084 | super-admin | super-admin-users-panel.tsx:107-114 | Reset password | submit | sendPasswordReset | N/A | WIRED |
| A-085 | super-admin | super-admin-users-panel.tsx:118-134 | Promote/Revoke super admin | submit | setSuperAdminFlag | N/A | WIRED |

## Pass 1 counts (A-xxx)

Total 85 · WIRED 85 · UNWIRED 0 · SUSPECT 0 (per module: accident-reports 10*, air-quality 22, audit-log 6, communications 3, daily-reports 6, employees 3, facility 3, ice-depth 2, modules 1, permissions 2, admin dashboard 1, super-admin 2, _components 1 — *filter rows collapsed above)
