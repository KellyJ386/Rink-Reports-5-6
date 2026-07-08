# Phase 0.2d — Interactive Elements: Shells, Auth, Dashboard, Splash, Account

| ID | Module | File:Line | Element | Type | Handler | Destination | Status |
|---|---|---|---|---|---|---|---|
| G-001 | splash | src/app/page.tsx:148 | Rink Reports wordmark | Link | href | / | WIRED |
| G-002 | splash | src/app/page.tsx:170 | Sign In | Link | href | /login | WIRED |
| G-003 | splash | src/app/page.tsx:173 | Request Information | Button | onClick | modal | WIRED |
| G-004–G-007 | splash | request-information.tsx:57-338 | Open / Close / Cancel / Send request | Button/submit | POST /api/information-requests | N/A | WIRED |
| G-008 | auth | login/login-form.tsx:18-41 | Login form + Sign in | form/submit | loginAction | /dashboard | WIRED |
| G-009 | auth | update-password-form.tsx:25-49 | Update password form + Set password | form/submit | updatePasswordAction | /dashboard | WIRED |
| G-010 | auth | (auth)/layout.tsx:17 | Brand link | Link | href | / | WIRED |
| G-011 | components/app | sidebar.tsx:31 | Wordmark | Link | href | /dashboard | WIRED |
| G-012 | components/app | sidebar-nav.tsx:99-108 | Staff nav (per-row ×11: Dashboard, Daily, Ice Depth, Ice Ops, Refrigeration, Air Quality, Incidents, Accidents, Scheduling, Communications, Facility Paperwork) | Link | href | see nav list below | WIRED |
| G-013 | components/app | sidebar-nav.tsx:115 | Admin Center (isAdmin only) | Link | href | /admin | WIRED |
| G-014 | components/app | mobile-sidebar.tsx:69-79 | Wordmark + mobile nav | Link/nav | setOpen(false); same as G-012 | /dashboard | WIRED |
| G-015–G-018 | components/app | bottom-tab-bar.tsx:50-79 | Home / Reports / Menu / Account | Link/Button | href / Sheet trigger | /dashboard, firstEnabledReportsHref, /account | WIRED |
| G-019 | components/app | global-header.tsx:153 | Back to Dashboard (admin header) | Button | router.push | /dashboard | WIRED |
| G-020 | components/app | global-header.tsx:188 | My Account | DropdownMenuItem | router.push | /account | WIRED |
| G-021 | components/app | global-header.tsx:193-209 | Sign out | form submit | POST /logout | /login | WIRED |
| G-022 | components/app | theme-toggle.tsx:47 | Theme toggle | Button | toggle + persist rr-theme | N/A | WIRED |
| G-023–G-024 | components/app | pwa-install-prompt.tsx:245-255 | Install app / Dismiss | Button | runInstall / dismiss | N/A | WIRED |
| G-025 | account | account-form.tsx:77-310 | Account profile form + Save | form/submit | updateAccountProfile | revalidate /account | WIRED |
| G-026 | account | account-form.tsx:326-334 | SMS opt-in toggle | Switch | form input sms_opt_in | N/A | WIRED |
| G-027 | dashboard | dashboard/page.tsx:109 | Module tiles (per-row) | Link | href | /reports/* | WIRED |
| G-028 | dashboard | dashboard/page.tsx:184 | Hide from dashboard | submit | hideDashboardModule | revalidate | WIRED |
| G-029 | dashboard | dashboard/page.tsx:333 | Restore to dashboard (per-row) | submit | showDashboardModule | revalidate | WIRED |
| G-030 | dashboard | dashboard/page.tsx:250 | Sign out | form submit | POST /logout | /login | WIRED |
| G-031–G-032 | forbidden | forbidden/page.tsx:50-53 | Go to home / Sign out | Link/submit | href / POST /logout | /, /login | WIRED |
| G-033 | offline-schedule | offline-schedule/page.tsx:20 | My schedule | Link | href | /reports/scheduling/my-schedule | WIRED |
| G-034 | components/admin | sidebar.tsx:29 | Wordmark | Link | href | /admin | WIRED |
| G-035 | components/admin | sidebar-nav.tsx:32-64 | Admin nav (per-row ×22) | Link | href | see nav list below | WIRED |
| G-036 | components/admin | mobile-sidebar.tsx:50-56 | Wordmark + mobile nav | Link/nav | setOpen(false) | /admin | WIRED |
| G-037–G-040 | components/admin | export-button.tsx:86-99 | Export dropdown: CSV / PDF / Custom range | DropdownMenuItem | fetch /api/exports?format= / router.push | /admin/exports | WIRED |
| G-041 | components/admin | load-more-link.tsx:19 | Load more | Link | href | ?show={larger} | WIRED |

## Counts
Total 71 (agent enumeration) · WIRED 71 · UNWIRED 0 · SUSPECT 0

## Shell navigation destinations (for route cross-check — all resolve to real routes in 01-routes.md)

- Staff shell: /dashboard, /reports/{daily, ice-depth, ice-operations, refrigeration, air-quality, incidents, accidents, scheduling, communications, facility-paperwork}, /admin (admins), /account
- Admin shell: /admin, /admin/{facility, modules, employees, departments, spaces, permissions, daily-reports, ice-depth, ice-operations, incident-reports, accident-reports, refrigeration, air-quality, scheduling, communications, facility-documents, lists, exports, retention, audit-log, super-admin}, /dashboard (header back)
- Bottom tab bar: /dashboard, firstEnabledReportsHref(), /account, Menu→Sheet
- Note: `/admin/roles` exists as a route but is **not** in the admin sidebar nav (reached from employees/roles flows) — verify intentional in Phase 1.
