# Phase 0.2a-iii — Interactive Elements: Admin final coverage pass (A3)

Covers: admin/spaces (full), admin/refrigeration setup/settings/filters/detail, admin/communications tabs (inbox, groups, routing, deliveries, audit, reminders full), admin/ice-depth (rinks, settings, history, analytics, session detail).

| ID | Module | File:Line | Element | Type | Handler | Status |
|---|---|---|---|---|---|---|
| A3-001–A3-003 | spaces | spaces-tab.tsx:88-125 | Seed defaults / Add space (×2) | Button | seedFacilitySpaces / openCreate | WIRED |
| A3-004–A3-007 | spaces | spaces-tab.tsx:177-215 | Edit / Deactivate / Reactivate / Delete (per-row; delete = window.confirm) | Button | setFacilitySpaceActive, deleteFacilitySpace | WIRED |
| A3-008–A3-009 | spaces | space-form.tsx:142-147 | Cancel / Create-Save | Button/submit | createFacilitySpace / updateFacilitySpace | WIRED |
| A3-010–A3-013 | refrigeration | setup-tab.tsx:75-201 | Seed defaults / section links (per-row) / new-section input / Add section | Button/Link/Input | seedDefaultRefrigerationSections, createSection | WIRED |
| A3-014–A3-017 | refrigeration | setup-tab.tsx:301-355 | Section: rename toggle / toggle active / delete (confirm) / save | Button/submit | setSectionActive, deleteSection, updateSection | WIRED |
| A3-018–A3-023 | refrigeration | setup-tab.tsx:389-527 | Equipment rows: edit / toggle / delete (confirm) / save / add | Button/submit | setEquipmentActive, deleteEquipment, update/createEquipment | WIRED |
| A3-024–A3-032 | refrigeration | setup-tab.tsx:570-918 | Field rows: move ± / thresholds toggle / edit / toggle active / delete (confirm) / save / add | Button/submit | moveField, setFieldActive, deleteField, update/createField | WIRED |
| A3-033–A3-038 | refrigeration | setup-tab.tsx:951-1187 | Threshold rows: edit / toggle / delete (confirm) / save / add | Button/submit | setThresholdActive, deleteThreshold, update/createThreshold | WIRED |
| A3-039–A3-041 | refrigeration | settings-tab.tsx:60-109 | Out-of-range alerts checkbox / severity select / Save | Checkbox/Select/submit | updateRefrigerationSettings | WIRED |
| A3-042–A3-047 | refrigeration | history-filters.tsx:65-145 | Employee / out-of-range / from / to / search / clear | Select/Input/Button | setParam, clearAll | WIRED |
| A3-048 | refrigeration | seed-defaults-card.tsx:42 | Seed defaults | Button | seedDefaultRefrigerationSections | WIRED |
| A3-049–A3-050 | refrigeration | report-detail.tsx:114-261 | Back to list / Add note | Link/submit | addRefrigerationFollowupNote | WIRED |
| A3-051–A3-052 | communications | inbox-tab.tsx:157-168 | Alerts / Messages view links | Link | buildHref | WIRED |
| A3-053–A3-059 | communications | inbox-tab.tsx:228-332 | Module/severity/resolved selects, from/to, search, clear | Select/Input/Button | setParam, clearAll | WIRED |
| A3-060 | communications | inbox-tab.tsx:369 | Alert item link (per-row) | Link | drill-down href | WIRED |
| A3-061–A3-063 | communications | inbox-tab.tsx:516-558 | Back to alerts / Re-open / Resolve | Link/Button | reopenAlert, resolveAlert | WIRED |
| A3-064–A3-066 | communications | groups-tab.tsx:108-192 | Group link (per-row) / name input / Add group | Link/Input/submit | createGroup | WIRED |
| A3-067–A3-070 | communications | groups-tab.tsx:261-339 | Edit / toggle / delete (confirm) / save group | Button/submit | setGroupActive, deleteGroup, updateGroup | WIRED |
| A3-071–A3-073 | communications | groups-tab.tsx:403-461 | Remove member (confirm) / member select / Add member | Button/Select/submit | removeGroupMember, addGroupMember | WIRED |
| A3-074–A3-077 | communications | routing-tab.tsx:181-204 | Preview recipients / edit / toggle / delete rule (confirm) | Button | previewRoutingRecipients, setRoutingRuleActive, deleteRoutingRule | WIRED |
| A3-078–A3-088 | communications | routing-tab.tsx:381-601 | Rule form: module/severity/timing selects, attach-PDF + requires-ack checkboxes, target-kind radios, group/role/department/employee selects, Save | Select/Checkbox/Radio/submit | create/updateRoutingRule | WIRED |
| A3-089–A3-090 | communications | deliveries-tab.tsx:65-196 | Retry failed email / outbox row (per-row) | Button | retryFailedEmail, retryFailedOutboxRow | WIRED |
| A3-091–A3-096 | communications | audit-tab.tsx:139-221 | Entity/action/actor selects, from/to, clear | Select/Input/Button | setParam, clearAll | WIRED |
| A3-097 | communications | audit-tab.tsx:263 | Diff toggle | Button | setExpanded | WIRED |
| A3-098–A3-108 | communications | reminders-tab.tsx:160-417 | Reminder: edit/toggle/delete (confirm); form: name/schedule/template/next-run/target radios+selects/Save | Button/Input/Select/submit | setReminderActive, deleteReminder, create/updateReminder | WIRED |
| A3-109–A3-115 | ice-depth | rinks-tab.tsx:118-246 | Rink: rename / make default / toggle / delete (confirm) / save / new toggle / create | Button/submit | setRinkDefault, setRinkActive, deleteRink, update/createRink | WIRED |
| A3-116–A3-122 | ice-depth | settings-tab.tsx:84-196 | Unit / alert-on selects, low/high thresholds, alerts_enabled, severity, Save | Select/Input/Checkbox/submit | updateIceDepthSettings | WIRED |
| A3-123–A3-125 | ice-depth | history-tab.tsx:89-172 | View session (per-row) / Load more / Reset filters | Link | hrefs | WIRED |
| A3-126–A3-132 | ice-depth | history-filters.tsx:61-156 | Layout/employee/has-low/has-high selects, from/to, clear | Select/Input/Button | setParam, clearAll | WIRED |
| A3-133 | ice-depth | analytics-tab.tsx:82 | Layout selector links (per-row) | Link | layoutHref | WIRED |
| A3-134–A3-138 | ice-depth | session-detail.tsx:140-319 | Back / delete trigger / cancel / confirm delete (AlertDialog) / Add note | Link/Button | deleteIceDepthSession, addIceDepthFollowupNote | WIRED |

## Counts (A3 pass)
spaces 9 · refrigeration 41 · communications 63 · ice-depth 25 → **total 138** · WIRED 138 · UNWIRED 0 · SUSPECT 0

Note for Phase 1 Agent B: the delete buttons marked "(confirm)" here use `window.confirm()` — same UX-consistency pattern as M-004/M-021/M-022/M-023 in 07-modals.md (refrigeration section/equipment/field/threshold deletes, communications group/member/routing-rule/reminder deletes, ice-depth rink delete, ice-operations setup deletes, facility-documents delete, incident-reports type/severity/activity deletes, lists option delete, daily-reports area delete).
