# Phase 0.2b — Interactive Elements: Admin Scheduling

| ID | Module | File:Line | Element | Type | Handler | Destination | Status |
|---|---|---|---|---|---|---|---|
| S-001 | scheduling | page.tsx:71 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-002 | scheduling | page.tsx:373 | View all → (pending swaps) | Link | href | /admin/scheduling/swaps | WIRED |
| S-003 | scheduling | page.tsx:390 | View all → (pending time-off) | Link | href | /admin/scheduling/time-off | WIRED |
| S-004 | scheduling | page.tsx:408 | View all → (open shifts) | Link | href | /admin/scheduling/shifts | WIRED |
| S-005 | scheduling | page.tsx:454-514 | ModuleCard links (×9) | Link | href | /admin/scheduling/* | WIRED |
| S-006 | scheduling/_components | scheduling-nav.tsx:52 | Nav item (per-row ×11) | Link | href + aria-current | /admin/scheduling/* | WIRED |
| S-007–S-010 | scheduling/_components | hub-panels.tsx:115-143 | Swap Approve/Deny/Confirm/Cancel | button | approveSwap / denySwap | server action | WIRED |
| S-011–S-014 | scheduling/_components | hub-panels.tsx:210-238 | Time-off Approve/Deny/Confirm/Cancel | button | decideTimeOffRequest | server action | WIRED |
| S-015–S-016 | scheduling/_components | hub-panels.tsx:342-345 | Approve claim / Decline (open shift) | button | decideOpenShiftClaim | server action | WIRED |
| S-017–S-018 | scheduling/_components | hub-panels.tsx:355-378 | Assign open shift + Confirm | button | assignOpenShift | server action | WIRED |
| S-019 | scheduling/_components | hub-panels.tsx:401 | ModuleCard link (per-row ×9) | Link | href | /admin/scheduling/* | WIRED |
| S-020 | shifts | page.tsx:77 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-021 | shifts/_components | week-grid.tsx:200 | Column drag-create | onPointerDown | setDrag kind:create | local | WIRED |
| S-022 | shifts/_components | week-grid.tsx:207 | Shift block select/move | onPointerDown | setDrag kind:move / onSelect | local | WIRED |
| S-023 | shifts/_components | week-grid.tsx:235 | Shift resize handle | onPointerDown | setDrag kind:resize | local | WIRED |
| S-024 | shifts/_components | week-grid.tsx:782 | Published shift keyboard activate | onKeyDown | onActivate | handler | WIRED |
| S-025 | shifts/_components | publish-button.tsx:43 | Request publish for window | button | setOpen | local | WIRED |
| S-026 | shifts/_components | publish-button.tsx:63 | File request | button | requestSchedulePublish | server action | WIRED |
| S-027 | shifts/_components | publish-button.tsx:66 | Cancel (publish request) | button | close | local | WIRED |
| S-028–S-030 | shifts/_components | week-board.tsx:696-720 | Week nav −1/+1/Today | button | navigate / goToday | router.replace | WIRED |
| S-031 | shifts/_components | week-board.tsx:~735 | View selector day/week/month | button ×3 | onViewChange | local | WIRED |
| S-032 | shifts/_components | week-board.tsx:~760 | Color-by switcher | button ×2 | onChange | local | WIRED |
| S-033 | shifts/_components | week-board.tsx:~775 | Density switcher | button ×3 | onChange | local | WIRED |
| S-034–S-035 | shifts/_components | week-board.tsx:~785-805 | Heatmap / template toggles | button | setHeatmap / setShowTemplate | local | WIRED |
| S-036 | shifts/_components | week-board.tsx:~815 | CSV export | button | exportCsv | file download | WIRED |
| S-037–S-039 | shifts/_components | board-pieces.tsx:155-329 | SegGroup + position filter chips (per-row) | button | onChange | local | WIRED |
| S-040–S-041 | shifts/_components | month-grid.tsx:~170-205 | Month day cell / shift chip | button | onSelectDay | router.replace | WIRED |
| S-042–S-045 | shifts/_components | assign-popover.tsx:176-248 | Start/End/Employee/Job-area selects | Select | onChange | popover state | WIRED |
| S-046–S-047 | shifts/_components | apply-template-form.tsx:95-98 | Cancel / Apply template | button | applyTemplateToWeek | server action | WIRED |
| S-048–S-053 | shifts/_components | board-pieces.tsx:470-575 | Shift detail: close/assign/job-area/edit/duplicate/delete | button/Select | onAssign / onEdit / createGridShift / deleteGridShift | server actions | WIRED |
| S-054–S-058 | templates/_components | templates-client.tsx:96-181 | Add/edit/activate/delete template + list links | button/Link | createTemplate/setTemplateActive/deleteTemplate | server actions | WIRED |
| S-059–S-062 | templates/_components | template-form.tsx, template-shift-form.tsx | Save/Cancel template + shift slot | button | createTemplate/updateTemplate/createTemplateShift/updateTemplateShift | server actions | WIRED |
| S-063 | publish | page.tsx:38 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-064 | publish/requests | requests-client.tsx:184 | Approve publish request | button | approveAndPublishRequest → RPC scheduling_approve_publish_request | server action | WIRED |
| S-065–S-067 | publish/requests | requests-client.tsx:230-250 | Reject toggle / Confirm reject / Cancel | button | rejectPublishRequest | server action | WIRED |
| S-068 | publish/requests | page.tsx:39 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-069 | time-off | page.tsx:78 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-070–S-074 | time-off/_components | time-off-list.tsx:136-188 | Approve/Deny/Cancel/Confirm/Close | button | decideTimeOffRequest / cancelTimeOffRequest | server actions | WIRED |
| S-075 | swaps | page.tsx:79 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-076–S-086 | swaps/_components | swaps-list.tsx:223-420 | Assign target / Approve / Deny / Cancel + confirms | button/Select | assignSwapTarget / approveSwap / denySwap / cancelSwap | server actions | WIRED |
| S-087 | compliance | page.tsx:40 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-088–S-095 | compliance/_components | compliance-client.tsx:77-280 | Add/move/toggle/edit/delete/submit/cancel rule | button | moveComplianceRule / setComplianceRuleActive / deleteComplianceRule / create/updateComplianceRule | server actions | WIRED |
| S-096 | job-areas | page.tsx:40 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-097–S-104 | job-areas/_components | job-areas-client.tsx:147-295 | Add/edit/move/toggle/delete area; add/remove cert | button/Switch | createJobArea / renameJobArea / moveJobArea / setJobAreaActive / deleteJobArea / add-removeJobAreaCertRequirement | server actions | WIRED |
| S-105 | settings | page.tsx:40 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-106–S-108 | settings/_components | settings-form.tsx:137-~400 | Week-start select, 7 setting inputs, Save | Select/Input/button | updateSchedulingSettings | server action | WIRED |
| S-109 | settings/_components | seed-defaults-button.tsx:~60 | Seed defaults | button | seedDefaultComplianceRules | server action | WIRED |
| S-110 | notifications | page.tsx:40 | Go to Facility Settings | Link+Button | href | /admin/facility | WIRED |
| S-111 | notifications/_components | send-reminders-form.tsx:53 | Send reminders | submit | sendShiftReminders | server action | WIRED |

## Counts
Total 111 · WIRED 111 · UNWIRED 0 · SUSPECT 0

## Publish / publish-lock mutation paths (inventory for Phase 1 Agent D)

| Action | File:Line | Mutation |
|---|---|---|
| requestSchedulePublish | _lib/publish-request-actions.ts:46 | INSERT schedule_publish_requests |
| approveAndPublishRequest | _lib/publish-request-actions.ts:110 | RPC scheduling_approve_publish_request (atomic: lock request, re-validate drafts, publish, audit, notify) |
| rejectPublishRequest | _lib/publish-request-actions.ts:164 | UPDATE status=rejected; guards requester ≠ approver (line 199) |
| updateGridShift (published) | _lib/grid-actions.ts (~549) | Routes to RPC scheduling_admin_edit_published_shift (republish + re-notify); direct UPDATE blocked by DB trigger schedule_shifts_publish_lock |
| deleteGridShift (published) | _lib/grid-actions.ts (~812) | No hard delete; marks cancelled + audit |

UI guards: week-grid.tsx:217-220 (published = select-only, no drag), 642-681 (resize handles hidden), 762 (useDraggable disabled), 784-789 (Enter opens republish popover).
