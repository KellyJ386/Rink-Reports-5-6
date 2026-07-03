# Phase 1 — Agent B: Button & Form Functionality

Read-only verification pass over the Phase 0 flagged items (M-030, M-031, F-038, R-009/B-001) plus systematic checks: double-submit protection, revalidation coverage, error-path rendering, and the definitive destructive-confirmation inventory.

## Summary

- **Phase 0 flags resolved:** M-030 and M-031 are non-issues (details below). F-038's server validation is adequate for a public endpoint. R-009 (`router.back()`) is confirmed as a real deep-link defect with a concrete fix.
- **Double-submit:** all 11 staff report submissions, all auth/account forms, and every admin CRUD form disable their submit while pending. Exactly **one** gap: the certification "Add" button on the employee detail page.
- **Revalidation:** every mutating server action in `src/app/admin/**` calls `revalidatePath` (several via shared `revalidate()` / `revalidateGovernance()` helpers — the raw grep ratios are misleading; each mutation was traced to a helper call). No stale-UI mutations found. The two zero-revalidate action files are a pure email send and a read-only health check.
- **Error paths:** every `useActionState` consumer renders `state.error` (inline `<p className="text-destructive">`, `FormError`, or `toast.error` in a `useEffect`). Every `startTransition` mutation caller surfaces `res.error` via toast. The 12 files with no error handling are all read-only URL-param navigations (filters, facility switcher) — verified individually.
- **Confirmations:** 40 `confirm()`/`window.confirm()` sites (Phase 0 estimated ~19). All are wired to real actions. **One destructive action has no confirmation at all:** deleting a shift from the admin scheduling week board (including *published* shifts, which are cancelled via the governed RPC) is a single un-confirmed click.
- **Idempotency:** offline replays are idempotent (`onConflict: "local_id", ignoreDuplicates: true` claim-token pattern in every `_lib/offline.ts`). Admin decision actions (`decideTimeOffRequest` status guard at governance-actions.ts:115, `approveSwap` via locking RPC `scheduling_apply_swap`) are safe on double invocation. Direct online report submits are plain INSERTs protected only by the pending-disable (noted as Info).

## Findings

| Severity | ID | file:line | Description | Suggested fix |
|---|---|---|---|---|
| Medium | B-01 | src/app/admin/scheduling/shifts/_components/week-board.tsx:477 (triggers: assign-popover.tsx:342, board-pieces.tsx:560) | `handleDelete` → `deleteGridShift` with **no confirmation**. One click on the Delete button in the shift popover or the selected-shift card deletes a draft shift outright, or cancels a *published* shift via `scheduling_admin_cancel_shift` (grid-actions.ts:790-820). No undo; event is removed optimistically. Every other destructive action in the app confirms first. | Wrap in an AlertDialog (or at minimum `confirm()`), with distinct wording for published shifts ("this cancels a published shift and notifies staff"). |
| Low | B-02 | src/app/reports/refrigeration/_components/submission-form.tsx:466 | Confirms R-009/B-001: the Back header button calls `router.back()`. On deep-link entry (PWA shortcut, shared URL, opened in new tab) history is empty or external, so Back exits the app or no-ops. Every other report shell uses an explicit href — ice-operations (`ice-ops-shell.tsx:84-89`) renders `<Button asChild><Link href="/reports">Back</Link></Button>`, and the form's own breadcrumb already points "Reports" at `/reports`. | Replace with `<Button asChild variant="outline" size="sm"><Link href="/reports"><ArrowLeft/>Back</Link></Button>` (parent = `/reports`, matching the breadcrumb and ice-ops shell). |
| Low | B-03 | src/app/admin/employees/[id]/_components/employee-detail.tsx:221,317 | CertificationsTab discards the transition pending flag (`const [, startTransition] = useTransition()`), so the "Add" button (line 317) never disables. A double-click inserts the certification twice (two optimistic rows + two server inserts; `addEmployeeCertification` has no dedupe). Only form in the audit without a pending-disable. | Keep the pending flag and set `disabled={pending}` on Add (and the editor Save at line 442). |
| Low | B-04 | src/app/admin/employees/[id]/_components/employee-detail.tsx:240-251 | Optimistic certification rows get a fake id (`tmp-${Date.now()}`) that is never reconciled: `rows` is `useState`-seeded from props and has no re-sync (contrast roles-matrix.tsx:59-62 `lastSynced` pattern, and GroupsTab which disables `pending-` rows at line 635). Edit/Delete on a just-added row sends the `tmp-…` id to `updateEmployeeCertification`/`deleteEmployeeCertification`, which fails until a full page reload. | Either re-sync rows from props (lastSynced pattern) or disable Edit/Delete for `tmp-` ids like GroupsTab does. |
| Low | B-05 | src/app/reports/scheduling/_components/availability-row.tsx:118, cancel-time-off-button.tsx:42 | Staff "Delete" (availability window) and "Cancel request" (time-off) execute immediately with no confirmation. Own-data, easily recreated, so Low — but they sit next to Edit and are one tap on mobile (h-11 targets). | Add a lightweight confirm (AlertDialog) or an undo toast. |
| Info | B-06 | 40 sites (list below) | Native `confirm()`/`window.confirm()` used for destructive admin actions instead of the AlertDialog used by employees/ice-depth-session/retention/roles. Functionally wired and safe; pure UX-consistency debt (not styleable, no dark-mode, blocks the thread). | Migrate to the shared AlertDialog pattern opportunistically. |
| Info | B-07 | e.g. src/app/reports/refrigeration/_lib/submit.ts:260-262, daily/_lib/submit.ts:141 | Direct (online) report submissions are plain INSERTs with no `local_id` dedupe — idempotency exists only on the offline replay path (`_lib/offline.ts` claim upsert, `onConflict: "local_id", ignoreDuplicates: true`). Double-submit is prevented client-side by pending-disable + redirect-to-done, but a request that times out *after* commit and is manually retried will create a duplicate report. | Optionally thread the client `localId` into the direct path and claim it the same way the offline replay does. |
| Info | B-08 | src/app/api/information-requests/route.ts:103-105 | Rate limiter **fails open**: if the `check_rate_limit` RPC errors, the insert proceeds (logged). Deliberate and documented; combined with no honeypot/captcha it means a DB-side RPC outage temporarily disables spam protection while inserts still work. | Acceptable as-is; consider a honeypot field in `request-information.tsx` as cheap defense-in-depth. |

## Phase 0 flagged-item resolutions

- **M-030 — employee-detail.tsx destructive action: RESOLVED, wired.** There is no "delete employee" on the detail page (that lives in `employees-client.tsx` behind an AlertDialog). The only destructive action here is **delete certification** (employee-detail.tsx:273-277): `window.confirm("Delete this certification?")` → optimistic row removal → `deleteEmployeeCertification` (revalidates `/admin/employees/${id}` at `[id]/actions.ts:314`), errors toasted. Confirmation present and action wired. Adjacent issues found: B-03, B-04.
- **M-031 — layout-editor.tsx point editor: RESOLVED, wired.** The "point editor overlay" is not a modal — it is an inline side-panel card (`SelectedPointEditor`, layout-editor.tsx:804-965). Open: click a point in Select mode (onPointPointerDown:532-535) or the numbered list (line 767). Close: "Close" button → `onClear()` (line 884), or delete success (line 867). Escape handling is n/a for an inline card (nothing is trapped; no focus lock needed). All actions wired with per-action `useTransition` pending disables (Save:926, Move:934/942, Activate:948, Delete:957); delete confirms (line 857); coordinate inputs validated 0–1 client-side (lines 826-832); errors toasted. Layout-level delete also confirms (line 192) and hard-navigates back to the layouts tab on success (line 203).
- **F-038 — /api/information-requests validation: ADEQUATE.** Server-side: JSON parse guard (400), required-field check name/email/company/country (route.ts:74-79), email regex (line 81), per-field length caps mirroring the DB CHECK constraints (LIMITS, lines 21-32; non-strings coerced to "" by `clean()`), and IP-based rate limiting (5 req / 10 min / IP) via the SECURITY DEFINER `check_rate_limit` RPC (lines 92-114) with 429 + Retry-After. Missing `x-forwarded-for` falls back to a shared "unknown" bucket rather than bypassing (lines 50-59). RLS: insert-only for anon; SELECT/UPDATE/DELETE super-admin-only (documented at lines 116-122). Client (`request-information.tsx`) renders API errors (lines 100-112, 295). Residual notes: B-08 (fail-open) only.
- **R-009/B-001 — refrigeration `router.back()`: CONFIRMED defect** → finding B-02 above. Correct explicit parent is **`/reports`** (matches the form's own breadcrumb `Reports → /reports` at submission-form.tsx:454 and the ice-ops shell's `<Link href="/reports">Back</Link>` at ice-ops-shell.tsx:84-89). It is the only `router.back()` in the entire `src/` tree.

## Definitive window.confirm() / confirm() inventory (40 sites)

Destructive deletes (38):

| # | file:line | Deletes |
|---|---|---|
| 1 | src/app/admin/communications/_components/templates-tab.tsx:72 | Communication template |
| 2 | src/app/admin/communications/_components/groups-tab.tsx:229 | Communication group (blocked if routing rules/reminders reference it) |
| 3 | src/app/admin/communications/_components/groups-tab.tsx:393 | Group member (remove person from group) |
| 4 | src/app/admin/communications/_components/routing-tab.tsx:144 | Routing rule |
| 5 | src/app/admin/communications/_components/reminders-tab.tsx:135 | Reminder |
| 6 | src/app/admin/scheduling/compliance/_components/compliance-client.tsx:147 | Scheduling compliance rule |
| 7 | src/app/admin/scheduling/templates/_components/templates-client.tsx:186 | Schedule template + its slots |
| 8 | src/app/admin/scheduling/templates/_components/template-shift-form.tsx:222 | Template slot |
| 9 | src/app/admin/scheduling/job-areas/_components/job-areas-client.tsx:113 | Job area (blocked if assigned) |
| 10 | src/app/admin/employees/[id]/_components/employee-detail.tsx:274 | Employee certification |
| 11 | src/app/admin/air-quality/_components/setup-tab.tsx:307 | AQ equipment |
| 12 | src/app/admin/air-quality/_components/setup-tab.tsx:612 | AQ reading type |
| 13 | src/app/admin/air-quality/_components/compliance-tab.tsx:261 | AQ compliance rule |
| 14 | src/app/admin/ice-depth/_components/rinks-tab.tsx:85 | Rink |
| 15 | src/app/admin/ice-depth/_components/layout-editor.tsx:192 | Layout (cascades all points) |
| 16 | src/app/admin/ice-depth/_components/layout-editor.tsx:857 | Measurement point |
| 17 | src/app/admin/facility-documents/_components/facility-documents-client.tsx:360 | Facility document (permanently removes file) |
| 18 | src/app/admin/lists/_components/options-tab.tsx:180 | List option |
| 19 | src/app/admin/ice-operations/_components/setup-tab.tsx:173 | Rink |
| 20 | src/app/admin/ice-operations/_components/setup-tab.tsx:380 | Equipment |
| 21 | src/app/admin/ice-operations/_components/setup-tab.tsx:725 | Circle-check item |
| 22 | src/app/admin/ice-operations/_components/setup-tab.tsx:1018 | Fuel type |
| 23 | src/app/admin/ice-operations/_components/setup-tab.tsx:1253 | Circle-check template + its fields |
| 24 | src/app/admin/ice-operations/_components/setup-tab.tsx:1426 | Circle-check template field |
| 25 | src/app/admin/spaces/_components/spaces-tab.tsx:217 | Facility space |
| 26 | src/app/admin/accident-reports/_components/dropdowns-tab.tsx:270 | Accident dropdown value |
| 27 | src/app/admin/daily-reports/_components/submission-detail.tsx:66 | Daily submission (items + notes) |
| 28 | src/app/admin/daily-reports/_components/submission-detail.tsx:89 | Submission note |
| 29 | src/app/admin/daily-reports/_components/templates-tab.tsx:205 | Daily template (+items; blocked if submissions exist) |
| 30 | src/app/admin/daily-reports/_components/areas-tab.tsx:251 | Work area (+templates/items; blocked if submissions exist) |
| 31 | src/app/admin/daily-reports/_components/items-tab.tsx:270 | Checklist item (past submissions keep snapshot) |
| 32 | src/app/admin/incident-reports/_components/severities-tab.tsx:176 | Severity level |
| 33 | src/app/admin/incident-reports/_components/activities-tab.tsx:227 | Incident activity |
| 34 | src/app/admin/incident-reports/_components/types-tab.tsx:176 | Incident type |
| 35 | src/app/admin/refrigeration/_components/setup-tab.tsx:269 | Refrigeration section (blocked if referenced) |
| 36 | src/app/admin/refrigeration/_components/setup-tab.tsx:417 | Refrigeration equipment |
| 37 | src/app/admin/refrigeration/_components/setup-tab.tsx:634 | Refrigeration field |
| 38 | src/app/admin/refrigeration/_components/setup-tab.tsx:992 | Refrigeration threshold |

Non-delete confirms (2):

| # | file:line | Action |
|---|---|---|
| 39 | src/app/admin/ice-depth/_components/layout-editor.tsx:386 | Renumber all active points 1..N (mutating, not destructive) |
| 40 | src/app/admin/scheduling/publish/requests/_components/requests-client.tsx:180 | Approve & publish all draft shifts in a window |

All 40 confirm before invoking a wired server action with a pending disable; errors are toasted or rendered inline. (Phase 0's estimate of ~19 undercounted; every entry above was traced to its action call.)

### Destructive actions with NO confirmation

1. **Delete/cancel shift from admin week board** — src/app/admin/scheduling/shifts/_components/assign-popover.tsx:342 and board-pieces.tsx:560 → week-board.tsx:477 `handleDelete` → `deleteGridShift` (grid-actions.ts:790). **Finding B-01.**
2. Staff availability delete — src/app/reports/scheduling/_components/availability-row.tsx:118 (own data). **Finding B-05.**
3. Staff cancel time-off — src/app/reports/scheduling/_components/cancel-time-off-button.tsx:42 (own pending request). **Finding B-05.**
4. Remove self-managed group membership — employee-detail.tsx:598 `remove()` (reversible add-back; not counted as a finding).

## Forms WITHOUT a pending-disable

Only one:

1. **Employee certification "Add"** — src/app/admin/employees/[id]/_components/employee-detail.tsx:317 (pending flag discarded at line 221). The editor "Save" (line 442) shares the gap but its action is an idempotent UPDATE. **Finding B-03.**

Borderline-but-safe (no pending indicator, verified harmless): `roles-matrix.tsx:53` — checkbox toggles discard pending, but each toggle writes an absolute boolean (idempotent) with optimistic rollback on error (lines 64-78).

Everything else checked and passing (submit disabled while pending): login/update-password (shared `SubmitButton`, src/components/auth/submit-button.tsx:23), account-form:33; all 11 staff report submissions — accidents (submission-form.tsx:782,823; edit-form.tsx:654), daily (daily-report-console.tsx:455), air-quality (:1437), incidents (:844,878), ice-depth (:1222), refrigeration (:994), 4× ice-operations (blade-change:156, circle-check:393, edging:133, ice-make:222), communications compose (:312) + acknowledge (:64) + message-detail (:150,:203), scheduling availability (:62)/time-off (:40)/swap (:57)/claim (:18)/cancel (:19)/swap-action (:31)/notification (:22)/availability-row delete (:35); admin — employee-form (:512,516), bulk-add-client (:314), bulk-import-card (:88), department/space/option/area/template/item/type/severity/activity/dropdown forms (all `useActionState` pending → submit disabled), facility-form (:206+), exports (:235), air-quality settings (:132) + compliance-profile (:281), scheduling settings (:246)/apply-template (:98)/send-reminders (:53)/template-form (:114)/publish-button (shifts/_components/publish-button.tsx:43,63)/swaps-list (:249-312)/time-off-list (:141-186), retention-row (:166,:220), facilities-panel (:126), layout-editor (all 9 actions), splash request-information (:324,340 via `submitting` state machine).

## Mutations WITHOUT revalidation

None with stale-UI risk. Full trace of the low-ratio action files:

- `admin/communications/actions.ts` — 24 mutations + 1 read (`previewRoutingRecipients`); every mutation calls the shared `revalidate()` (line 111 → `/admin/communications`); 25 call sites counted.
- `admin/roles/actions.ts` — shared `revalidate()` (lines 42-46 → roles/permissions/employees); 8 call sites for 7 exports.
- `admin/scheduling/_lib/governance-actions.ts` — shared `revalidateGovernance()` (lines 74-81); 13 call sites, one per mutation.
- `admin/scheduling/job-areas/actions.ts` — shared `revalidate()` (line 79); 9 call sites.
- Zero-revalidate files, all legitimately so: `admin/air-quality/log/actions.ts` (`sendAirQualityLog` — emails a PDF, changes no rendered data), `admin/super-admin` `checkInviteServiceHealth` (read-only probe, result rendered from local state), `admin/employees/_lib/job-areas.ts`, `admin/lists/_lib/facility-dropdowns.ts` (uses `unstable_cache` + tag invalidation), `scheduling/_lib/enforcement.ts`, `grid-warnings.ts` (plain server-only helper modules, not actions).

No silent error swallowing found: every action file follows the `try/catch → logServerError → return { ok:false, error }` pattern; spot-checked communications, governance, grid-actions, roles, employees/[id], retention.

## Verified OK

- **Error-path rendering (task 5): PASS across the board.** Automated sweep: every `useActionState` consumer references `state.error`/`status === "error"`/`FormError` (single non-match is `components/ui/form-field.tsx`, a presentational primitive). Every `startTransition` caller either toasts `res.error` or is a read-only URL-param navigation (7 history-filter components, submission-filters, scope-picker, facility-switcher, audit-tab filter, diagram-nav — all verified as `router.replace/push` only). Retention purge errors render inline (retention-row.tsx:157,235); admin swap/time-off decisions toast (swaps-list.tsx:149-186, time-off-list.tsx:91-100); splash form renders API error message (request-information.tsx:295).
- **Offline idempotency:** all five `_lib/offline.ts` replay modules (daily, ice-operations, ice-depth, accidents, communications) use the `offline_sync_queue` `local_id` claim-token upsert (`onConflict: "local_id", ignoreDuplicates: true`) so a double flush is a no-op.
- **Decision idempotency:** `decideTimeOffRequest` rejects non-pending rows (governance-actions.ts:115-117); `approveSwap` delegates to the locking `scheduling_apply_swap` RPC (:323); `deleteGridShift` re-reads status and routes published shifts through the governed cancel RPC (grid-actions.ts:802-820).
- **Publish request flow:** two-step (file request → different admin approves), both confirm/pending-guarded (publish-button.tsx, requests-client.tsx:180).
- **M-004/M-021/M-022/M-023** (Phase 0 SUSPECTs): all four are confirmed-and-wired `window.confirm` deletes — reclassified into the B-06 UX-consistency bucket, no safety hole.
