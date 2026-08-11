# 7. Quick Reference

## 7.1 Status lifecycles at a glance

| Object | Statuses |
|---|---|
| Schedule shift | draft → published → cancelled |
| Time-off request | pending → approved / denied / cancelled |
| Swap request | pending → accepted → manager approved (applied); or denied / cancelled / expired |
| Shift drop request | pending → approved / denied / withdrawn |
| Publish request | pending → published / rejected |
| Incident report | Submitted → In review → Resolved → Archived |
| Offline queue item | pending → synced / failed / won't retry |

## 7.2 Who approves what (scheduling)

| Request | Approver |
|---|---|
| Time off | Any scheduling admin |
| Swap | Scheduling admin, after the target accepts |
| Shift drop | Scheduling admin (unless approval is turned off — then instant) |
| Open-shift claim | Automatic if first-come-first-served; otherwise a scheduling admin |
| Publishing a schedule | A *different* admin than the requester — always two people |
| Certification override | A facility manager only — always audit-logged |

## 7.3 Edit windows and immutability

| Report type | After submitting |
|---|---|
| Incident report | Reporter can edit for 24 hours, then read-only |
| Accident report | Reporter can edit for 24 hours, then read-only |
| Daily report | Corrections only (original stays on record) |
| Ice depth / Ice operations / Refrigeration / Air quality | Immutable immediately |
| Admin follow-up notes (all modules) | Append-only — can never be edited or deleted |

## 7.4 What works offline

| Works offline (queued) | Online only |
|---|---|
| All report submissions (daily, incidents, accidents, ice depth, ice ops, refrigeration, air quality, dasher issues & walks) | Editing an existing report |
| Time-off requests, availability changes | Claiming, dropping, and swapping shifts |
| Composing messages | Acknowledging alerts, marking read |
| Viewing /offline-daily, /offline-forms, /offline-schedule | All admin console work |

On iPhone/iPad, open the app and tap **Sync now** in the Pending Sync Queue after working offline — iOS doesn't sync in the background.

## 7.5 Permission actions

| Action | Means |
|---|---|
| View | Can see the module |
| Submit | Can create and submit entries |
| Edit | Can modify own or facility submissions (e.g. acknowledge severity-A dasher issues, supervisor tiers) |
| Admin | Can configure the module and use its admin console |

Special cells: **Admin module × Admin action** = the Admin Center key (super-admin-only to grant). Module consoles need the *module's* Admin action on top of console access.

## 7.6 Super-admin-only operations

Create/edit facilities · delete employees · grant Admin Center access · assign admin-tier roles · promote/revoke super admins · generate password-reset links · switch facility context · delete ice-depth sessions, refrigeration reports, and air-quality reports.

## 7.7 Training checklists

**New staff member — first session (30 minutes):**

1. Sign in from the invite email and set a password.
2. Tour the dashboard tiles and status bubbles; hide unused tiles.
3. Fill in Account settings (phone, address, emergency contact).
4. Submit a practice report in your primary module.
5. Scheduling: set availability for each weekday, set up calendar sync, find the Drop and Swap buttons.
6. Turn on airplane mode and submit a report — watch it queue and sync.
7. Find the Pending Sync Queue and the offline schedule page.

**New admin — first session (60 minutes):**

1. Tour the console: Setup vs. Module Admin vs. System groups; know that the sidebar isn't permission-filtered and Roles isn't in it.
2. Walk the setup checklist on the admin dashboard.
3. Create a test employee with an invite; watch the role defaults apply.
4. Open the Permissions matrix; find the Admin Center cell and understand why it's special.
5. Configure one module end-to-end (e.g. refrigeration sections → fields → thresholds → submit a test report → see the out-of-range flag → watch the routing rule fire).
6. Scheduling: draw shifts, hit a cert block, file a publish request, approve it as a second admin.
7. Review retention floors and the audit log.
