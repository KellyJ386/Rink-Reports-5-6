# Phase 0.1 — Route Map

## Proxy summary

`src/proxy.ts` matches all routes except Next static assets/favicon (`/((?!_next/static|_next/image|favicon.ico).*)`) and delegates to `updateSession()` (`src/lib/supabase/session.ts`), which refreshes the Supabase auth cookie and enforces: unauthenticated → `/login?redirectTo=…` for `/admin`, `/reports`, `/dashboard`; authenticated hitting `/login`/`/signup` → `/dashboard`. Page/layout-level guards (`requireUser` / `requireAdmin` from `src/lib/auth`) provide the authorization layer on top.

## Route table

| Route (URL path) | File | Kind | Guard | Parent route | Breadcrumb/Back present? |
|---|---|---|---|---|---|
| / | src/app/page.tsx | page | getCurrentUser (redirects to /dashboard if authenticated) | none | No |
| /login | src/app/(auth)/login/page.tsx | page | None (public) | (auth) | No |
| /update-password | src/app/(auth)/update-password/page.tsx | page | None (public auth callback) | (auth) | No |
| /(auth)/callback | src/app/(auth)/callback/route.ts | route-handler (GET) | None (OAuth callback) | (auth) | N/A |
| /(auth)/logout | src/app/(auth)/logout/route.ts | route-handler (POST) | None (unauthenticated calls OK) | (auth) | N/A |
| /dashboard | src/app/dashboard/page.tsx | page | requireUser (in layout) | dashboard layout | PageHeader, no explicit back |
| /account | src/app/account/page.tsx | page | requireUser (in layout) | account layout | Header only, no breadcrumb |
| /account/[userId] | src/app/account/[userId]/page.tsx | page | requireUser (in layout) | account layout | No breadcrumb visible |
| /forbidden | src/app/forbidden/page.tsx | page | getCurrentUser (shows signed-in user info) | none | Links to / or logout |
| /offline-schedule | src/app/offline-schedule/page.tsx | page | None (public, service-worker cached) | offline-schedule layout | Back link to /reports/scheduling/my-schedule |
| /reports | src/app/reports/page.tsx | page | Redirects to /dashboard (redirect()) | reports layout | N/A |
| /reports/accidents | src/app/reports/accidents/page.tsx | page | requireUser (layout) + currentUserCan("accident_reports","submit") | reports layout | PageHeader with breadcrumb |
| /reports/accidents/[id] | src/app/reports/accidents/[id]/page.tsx | page | requireUser (layout) | reports layout | Detail view |
| /reports/daily | src/app/reports/daily/page.tsx | page | requireUser (layout) + getAllowedDailyAreas() | reports layout | PageHeader with breadcrumb |
| /reports/daily/[areaSlug]/[templateId]/done | src/app/reports/daily/[areaSlug]/[templateId]/done/page.tsx | page | requireUser (layout) | reports layout | Confirmation page |
| /reports/daily/history | src/app/reports/daily/history/page.tsx | page | requireUser (layout) | reports layout | History view |
| /reports/air-quality | src/app/reports/air-quality/page.tsx | page | requireUser (layout) + permission check | reports layout | PageHeader with breadcrumb |
| /reports/air-quality/done | src/app/reports/air-quality/done/page.tsx | page | requireUser (layout) | reports layout | Confirmation |
| /reports/communications | src/app/reports/communications/page.tsx | page | requireUser (layout) + permission check | reports layout | PageHeader with breadcrumb |
| /reports/communications/compose | src/app/reports/communications/compose/page.tsx | page | requireUser (layout) + permission check | reports layout | Form page |
| /reports/communications/compose/done | src/app/reports/communications/compose/done/page.tsx | page | requireUser (layout) | reports layout | Confirmation |
| /reports/facility-paperwork | src/app/reports/facility-paperwork/page.tsx | page | requireUser (layout) | reports layout | Report list |
| /reports/incidents | src/app/reports/incidents/page.tsx | page | requireUser (layout) + permission check | reports layout | PageHeader with breadcrumb |
| /reports/incidents/[id] | src/app/reports/incidents/[id]/page.tsx | page | requireUser (layout) | reports layout | Detail view |
| /reports/incidents/done | src/app/reports/incidents/done/page.tsx | page | requireUser (layout) | reports layout | Confirmation |
| /reports/ice-depth | src/app/reports/ice-depth/page.tsx | page | requireUser (layout) + permission check | reports layout | PageHeader with breadcrumb |
| /reports/ice-depth/[layoutSlug] | src/app/reports/ice-depth/[layoutSlug]/page.tsx | page | requireUser (layout) | reports layout | Form page |
| /reports/ice-depth/[layoutSlug]/done | src/app/reports/ice-depth/[layoutSlug]/done/page.tsx | page | requireUser (layout) | reports layout | Confirmation |
| /reports/ice-depth/[layoutSlug]/done/pdf | src/app/reports/ice-depth/[layoutSlug]/done/pdf/route.ts | route-handler (GET) | requireUser (generates PDF) | N/A | N/A |
| /reports/ice-operations | src/app/reports/ice-operations/page.tsx | page | requireUser (layout) + permission check | reports layout | PageHeader with breadcrumb |
| /reports/ice-operations/[operationType] | src/app/reports/ice-operations/[operationType]/page.tsx | page | requireUser (layout) | reports layout | Form page (tabs) |
| /reports/ice-operations/[operationType]/done | src/app/reports/ice-operations/[operationType]/done/page.tsx | page | requireUser (layout) | reports layout | Confirmation |
| /reports/refrigeration | src/app/reports/refrigeration/page.tsx | page | requireUser (layout) + permission check | reports layout | PageHeader with breadcrumb |
| /reports/refrigeration/done | src/app/reports/refrigeration/done/page.tsx | page | requireUser (layout) | reports layout | Confirmation |
| /reports/scheduling | src/app/reports/scheduling/page.tsx | page | requireUser (layout) | reports layout | PageHeader with breadcrumb |
| /reports/scheduling/my-schedule | src/app/reports/scheduling/my-schedule/page.tsx | page | requireUser (layout) | reports layout | Schedule view |
| /reports/scheduling/availability | src/app/reports/scheduling/availability/page.tsx | page | requireUser (layout) | reports layout | Availability form |
| /reports/scheduling/availability/[date] | src/app/reports/scheduling/availability/[date]/page.tsx | page | requireUser (layout) | reports layout | Date-specific availability |
| /reports/scheduling/swaps | src/app/reports/scheduling/swaps/page.tsx | page | requireUser (layout) | reports layout | Shift swaps |
| /reports/scheduling/time-off | src/app/reports/scheduling/time-off/page.tsx | page | requireUser (layout) | reports layout | Time-off form |
| /reports/scheduling/notifications | src/app/reports/scheduling/notifications/page.tsx | page | requireUser (layout) | reports layout | Notifications |
| /reports/offline-queue | src/app/reports/offline-queue/page.tsx | page | requireUser (layout) | reports layout | Offline queue status |
| /admin | src/app/admin/page.tsx | page | requireAdmin (layout) | admin layout | PageHeader |
| /admin/accident-reports | src/app/admin/accident-reports/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/air-quality | src/app/admin/air-quality/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/air-quality/log | src/app/admin/air-quality/log/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/air-quality/log/pdf | src/app/admin/air-quality/log/pdf/route.ts | route-handler (GET) | requireAdmin | N/A | N/A |
| /admin/audit-log | src/app/admin/audit-log/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/communications | src/app/admin/communications/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/daily-reports | src/app/admin/daily-reports/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/departments | src/app/admin/departments/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/employees | src/app/admin/employees/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/employees/[id] | src/app/admin/employees/[id]/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/employees/bulk | src/app/admin/employees/bulk/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/exports | src/app/admin/exports/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/facility | src/app/admin/facility/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/facility-documents | src/app/admin/facility-documents/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/ice-depth | src/app/admin/ice-depth/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/ice-operations | src/app/admin/ice-operations/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/incident-reports | src/app/admin/incident-reports/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/lists | src/app/admin/lists/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/modules | src/app/admin/modules/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/permissions | src/app/admin/permissions/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/permissions/[userId] | src/app/admin/permissions/[userId]/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/refrigeration | src/app/admin/refrigeration/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/retention | src/app/admin/retention/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/roles | src/app/admin/roles/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/scheduling | src/app/admin/scheduling/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | Scheduling hub |
| /admin/scheduling/compliance | src/app/admin/scheduling/compliance/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/job-areas | src/app/admin/scheduling/job-areas/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/notifications | src/app/admin/scheduling/notifications/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/publish | src/app/admin/scheduling/publish/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/publish/requests | src/app/admin/scheduling/publish/requests/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/settings | src/app/admin/scheduling/settings/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/shifts | src/app/admin/scheduling/shifts/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/swaps | src/app/admin/scheduling/swaps/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/templates | src/app/admin/scheduling/templates/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/scheduling/time-off | src/app/admin/scheduling/time-off/page.tsx | page | requireAdmin (layout ×2) | admin/scheduling layout | — |
| /admin/spaces | src/app/admin/spaces/page.tsx | page | requireAdmin (layout) | admin layout | — |
| /admin/super-admin | src/app/admin/super-admin/page.tsx | page | requireAdmin (layout) + super-admin check in page | admin layout | — |
| /api/health | src/app/api/health/route.ts | route-handler (GET) | None (public); optional CRON_SECRET for detail | N/A | N/A |
| /api/exports | src/app/api/exports/route.ts | route-handler (GET) | requireAdmin + module permission (view) | N/A | N/A |
| /api/information-requests | src/app/api/information-requests/route.ts | route-handler (POST) | None (public); IP rate limiting | N/A | N/A |
| /api/offline-sync | src/app/api/offline-sync/route.ts | route-handler (POST) | getCurrentUser + per-module permission | N/A | N/A |
| /api/cron/run-reminders | src/app/api/cron/run-reminders/route.ts | route-handler (GET) | CRON_SECRET bearer | N/A | N/A |
| /api/cron/drain-notifications | src/app/api/cron/drain-notifications/route.ts | route-handler (GET) | CRON_SECRET bearer | N/A | N/A |
| /api/cron/send-communications | src/app/api/cron/send-communications/route.ts | route-handler (GET) | CRON_SECRET bearer | N/A | N/A |
| /api/cron/expire-scheduling | src/app/api/cron/expire-scheduling/route.ts | route-handler (GET) | CRON_SECRET bearer | N/A | N/A |
| /api/cron/run-retention-purge | src/app/api/cron/run-retention-purge/route.ts | route-handler (GET) | CRON_SECRET bearer | N/A | N/A |

## Layouts / error boundaries / loading

| Scope | File | Guard |
|---|---|---|
| root layout | src/app/layout.tsx | none (providers) |
| (auth) layout | src/app/(auth)/layout.tsx | none (public) |
| account layout | src/app/account/layout.tsx | requireUser |
| dashboard layout | src/app/dashboard/layout.tsx | requireUser |
| admin layout | src/app/admin/layout.tsx | requireAdmin |
| admin/scheduling layout | src/app/admin/scheduling/layout.tsx | requireAdmin (second layer) |
| reports layout | src/app/reports/layout.tsx | requireUser |
| offline-schedule layout | src/app/offline-schedule/layout.tsx | none (SW cached) |
| error boundaries | src/app/error.tsx, admin/error.tsx, admin/scheduling/error.tsx, reports/error.tsx | client error handlers |
| not-found | src/app/not-found.tsx | links to /dashboard |
| loading | admin/loading.tsx + ~39 admin skeletons; ~14 reports skeletons | — |

Note: there is **no `/signup` page** in the app (the proxy redirect rule mentions it, but only `/login` exists; accounts are provisioned via admin/employees flows).
