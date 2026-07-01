# Phase 0.2c — Interactive Elements: Staff Reports (`/reports/**`)

| ID | Module | File:Line | Element | Type | Handler | Destination | Status |
|---|---|---|---|---|---|---|---|
| R-001 | daily | daily/page.tsx:79-83 | View history | Button+Link | href | /reports/daily/history | WIRED |
| R-002 | daily | daily-report-console.tsx:239-269 | Work area select | Select | handleAreaChange | N/A | WIRED |
| R-003 | daily | daily-report-console.tsx:284-308 | Shift select | Select | handleTemplateChange | N/A | WIRED |
| R-004 | daily | daily-report-console.tsx:349-392 | Checklist items (per-row) | Checkbox | setChecked | N/A | WIRED |
| R-005 | daily | daily-report-console.tsx:452-459 | Submit | submit | submitDailyReportAction | done page | WIRED |
| R-006 | daily | done/page.tsx:117 | Submit another | Link | href | /reports/daily | WIRED |
| R-007 | daily | history/page.tsx | History list (read-only) | — | — | — | N/A |
| R-009 | refrigeration | submission-form.tsx:462-477 | Back | Button | router.back() | browser history | **SUSPECT** (deep-link unsafe; see B-001) |
| R-010 | refrigeration | submission-form.tsx:471-476 | Dashboard | Button+Link | href | /dashboard | WIRED |
| R-011 | refrigeration | submission-form.tsx:532 | UnitToggle °F/°C | role=switch | setUnit | N/A | WIRED |
| R-012–R-014 | refrigeration | submission-form.tsx:539-571 | Reading time / shift / round inputs | Input | setters | N/A | WIRED |
| R-015–R-016 | refrigeration | submission-form.tsx:598-877 | Metadata-driven FieldInputs incl. selects (per-field) | FieldInput | updateText/updateBool/onText | N/A | WIRED |
| R-017 | refrigeration | submission-form.tsx:~690 | Notes textarea | Textarea | setNotes | N/A | WIRED |
| R-018 | refrigeration | submission-form.tsx:988-1003 | Submit | submit | submitRefrigerationReport | done page | WIRED |
| R-019–R-020 | refrigeration | done/page.tsx:110-120 | Submit another / Back to home | Link | href | /reports/refrigeration, /reports | WIRED |
| R-022 | incidents | incidents/_components/submission-form.tsx | Full incident form (fields + confirm dialog M-018) | form | submitIncidentReport | done page | WIRED |
| R-023–R-025 | incidents | done/page.tsx:146-161 | Edit report / Submit another / Back to home | Link | href | /reports/incidents/{id}, /reports/incidents, /reports | WIRED |
| R-026 | incidents | [id]/page.tsx | Edit form | form | updateIncidentReport | revalidate | WIRED |
| R-028 | accidents | accidents/_components/submission-form.tsx | Full accident form (body diagram, severity pills, sticky submit + confirm dialog M-019) | form | submitAccidentReport | done page | WIRED |
| R-029 | accidents | accidents/[id] | Detail/edit form | form | updateAccidentReport | revalidate | WIRED |
| R-031 | air-quality | air-quality/_components/submission-form.tsx:74+ | DB-driven reading inputs w/ RangeBadgePills | form | submitAirQualityReport | done page | WIRED |
| R-032–R-033 | air-quality | done/page.tsx:141-150 | Submit another / Back to home | Link | href | /reports/air-quality, /reports | WIRED |
| R-034 | ice-depth | ice-depth/page.tsx | Auto-redirect to default layout | redirect() | — | /reports/ice-depth/{slug} | WIRED |
| R-035 | ice-depth | [layoutSlug]/page.tsx:193-202 | Back | Button | href | /reports/ice-depth | WIRED |
| R-036 | ice-depth | diagram-nav.tsx | Rink + diagram selects | Select | onValueChange | navigation | WIRED |
| R-037 | ice-depth | submission-form.tsx | SVG rink points (per-point) | SVG g onClick/onKeyDown | point selection | N/A | WIRED |
| R-038 | ice-depth | submission-form.tsx | Phase toggle (measure→review) | button | phase transition | N/A | WIRED |
| R-039 | ice-depth | submission-form.tsx | Submit (offline-aware) | submit | submitIceDepthSession | done page | WIRED |
| R-040 | ice-depth | done/page.tsx:340-350 | Back to Form | Link+Button | href | /reports/ice-depth/{slug} | WIRED |
| R-041 | ice-depth | print-diagram-button.tsx:44 | Print Diagram | button | window.print() | N/A | WIRED |
| R-042 | ice-depth | send-report-button.tsx:44 | Send Report | button | sendIceDepthReport | N/A | WIRED |
| R-043 | ice-depth | done/page.tsx:474-487 | Download PDF | a | href | /reports/ice-depth/{slug}/done/pdf?id={id} | WIRED |
| R-044–R-045 | ice-depth | done/page.tsx:492-507 | Submit Another / Back to Dashboard | Link+Button | href | /reports/ice-depth, /dashboard | WIRED |
| R-046 | ice-operations | ice-operations/page.tsx | Auto-redirect | redirect() | — | /reports/ice-operations/{DEFAULT_TYPE} | WIRED |
| R-047 | ice-operations | [operationType]/page.tsx:59-66 | Operation-type tabs | TabNav | href | /reports/ice-operations/{type} | WIRED |
| R-048–R-051 | ice-operations | ice-make / edging / blade-change / circle-check forms | Form controls (per-type; circle-check = checkbox grid + template select) | form | submitIceOperationsReport | done page | WIRED |
| R-052 | ice-operations | done/page.tsx | Done screen links | Link | href | /reports/ice-operations | WIRED |
| R-053–R-054 | communications | page.tsx + inbox-tabs.tsx | Inbox tabs (alerts/messages) | TabNav | href params / onValueChange | ?inbox= | WIRED |
| R-055 | communications | alerts-list.tsx | Acknowledge (per-row, AlertDialog) | button | acknowledgeAlert | N/A | WIRED |
| R-056 | communications | messages-list.tsx | Message items (per-row) | clickable | detail view | N/A | WIRED |
| R-057 | communications | message-detail.tsx | Reply compose | Textarea+Button | replyToMessage | N/A | WIRED |
| R-058 | communications | compose/page.tsx | Compose form | form | sendCommunicationsMessage | done page | WIRED |
| R-059 | communications | compose/done/page.tsx | Done links | Link | href | /reports/communications | WIRED |
| R-060–R-062 | scheduling | page.tsx:353-484 | Request swap / Full schedule / View all | Link | href | /reports/scheduling/{swaps,my-schedule} | WIRED |
| R-063 | scheduling | page.tsx:635 | Claim open shift (per-shift) | Button | claimOpenShift | N/A | WIRED |
| R-064 | scheduling | page.tsx:698-722 | Quick links grid (×4) | Link | href | /reports/scheduling/* | WIRED |
| R-065 | scheduling | my-schedule/page.tsx | Shift list (read-only) | — | — | — | N/A |
| R-066 | scheduling | swaps/page.tsx | Swap form | form | submitSwapRequest | N/A | WIRED |
| R-067 | scheduling | time-off/page.tsx | Time-off form + cancel (per-row) | form/Button | submitTimeOffRequest / cancelTimeOff | N/A | WIRED |
| R-068–R-069 | scheduling | availability pages | Availability forms | form | upsertAvailability | N/A | WIRED |
| R-070 | scheduling | notifications/page.tsx | Notification list (read-only) | — | — | — | N/A |
| R-071 | scheduling | availability-add-toggle.tsx | Add-shift toggle | role=switch | toggleAdd | N/A | WIRED |
| R-073 | scheduling | week-calendar.tsx | Calendar day selectors (per-day) | button | selectDay | N/A | WIRED |
| R-076 | scheduling | cancel-time-off-button.tsx | Cancel (per-row) | Button | cancelTimeOff | N/A | WIRED |
| R-077 | scheduling | claim-open-shift-button.tsx | Claim | Button | claimOpenShift | N/A | WIRED |
| R-079 | offline-queue | offline-queue-view.tsx | Retry (per-queued-item) | Button | retrySync → retryFailedSubmissions | N/A | WIRED |
| R-081 | facility-paperwork | documents-browser.tsx | Download links (per-doc) | a[download] | signedUrl | storage URL | WIRED |

## Counts
Total 81 (agent enumeration) · WIRED 80 · UNWIRED 0 · SUSPECT 1 (R-009 router.back — cross-ref B-001)

## Ice-depth photo check (mission item 7)
Confirmed: **no photo/camera/image-upload feature exists** in src/app/reports/ice-depth/** or src/components/ice-depth/** (grep for photo/camera/image/upload — only match is the PDF export route). Matches expectation.
