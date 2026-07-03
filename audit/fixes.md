# Phase 3 — AUTO-FIX Log

Fixes applied under AUTO-FIX authority (dead links, broken back arrows, missing
confirmations on destructive UI actions, config-drift, stale copy). ASK-FIRST
items (auth, RBAC, RLS, facility_id, publish-lock logic, offline sync,
migrations) are NOT here — they are in `audit/ask-first-plan.md` for approval.

### N-001 / B-02 — Refrigeration "Back" used router.back() (deep-link unsafe)
- `src/app/reports/refrigeration/_components/submission-form.tsx:466`
- Before: `<Button onClick={() => router.back()}>…Back</Button>` (broke on direct URL entry / refresh)
- After: `<Button asChild><Link href="/reports">…Back</Link></Button>` (explicit parent, matches breadcrumb + ice-ops shell pattern)
- Also removed the now-unused `useRouter` import and `const router` (line 4 / 209) to keep lint clean.
- The only `router.back()` in the app; no others remain.

### B-01 — Admin week-board shift delete has no confirmation
- `src/app/admin/scheduling/shifts/_components/week-board.tsx` (handleDelete ~477, ShiftDetail onDelete 845, popover onDelete via handlePopoverDelete 561)
- Before: `handleDelete(id)` fired `deleteGridShift(id)` immediately from both the ShiftDetail trash button and the AssignPopover "Delete".
- After: split into `performDelete` (the real RPC call) and `handleDelete` which now sets `pendingDeleteId` to open a shadcn `AlertDialog` (same controlled pattern as employees-client). Confirm calls `performDelete`. Dialog copy warns that deleting a **published** shift cancels it for staff (branches on the event's `status === "published"`).
- UI-only: no change to `grid-actions.ts` / the governed RPC. Existing optimistic remove + pending/disabled behavior preserved.

### B-05 — Staff destructive actions lack confirmation
- `src/app/reports/scheduling/_components/availability-row.tsx` — delete availability window
- `src/app/reports/scheduling/_components/cancel-time-off-button.tsx` — cancel time-off request
- Before: the outline submit button submitted the form action directly with no confirm.
- After: each visible button is now an `AlertDialogTrigger` (`type="button"`), and confirming fires the form via `formRef.current?.requestSubmit()` — matching the repo's proven incidents/accidents pattern (`submission-form.tsx:324`).
- **Correction (orchestrator):** the agent's first pass put `AlertDialogAction type="submit"` *inside* the dialog. This repo's `AlertDialogContent` is Radix-**portaled** (`ui/alert-dialog.tsx:35`), so that button renders outside the `<form>`, has no form owner, and would NOT submit — the confirm would silently no-op. Rewrote both to controlled `AlertDialog` + `formRef.requestSubmit()`, and switched pending state from `useFormStatus` (child) to the `useActionState` 3-tuple `isPending` (parent). Copy: "Delete this availability window?" / "Cancel this time-off request?".

### C-01 — Dashboard tiles ignore the facility module toggle
- `src/app/dashboard/page.tsx` (~264 visibleModules)
- Before: tiles were filtered only by the employee's `hidden_modules`; a facility-disabled module still showed a tile (nav already hid it).
- After: load `getEnabledModuleKeys(employeeRow.facility_id)` from `@/lib/modules/facility-modules` — the exact same server helper the sidebar uses via the dashboard layout — and pre-filter `allKeys` with a fail-open `isFacilityEnabled` (null = show all, matching sidebar semantics). Both the visible grid and the "Hidden tiles" restore section now respect it.
- Visibility only; no route-blocking added.

### C-05 — my-schedule hardcodes Sunday weeks
- `src/app/reports/scheduling/my-schedule/page.tsx` (~134 getWeekStart)
- Before: local `getWeekStart` forced Sunday via `d.getDate() - d.getDay()`.
- After: removed it; read `schedule_settings.week_start_day` for the employee's facility (same query as the availability page) and compute via the shared `startOfWeek(anchor, weekStartDay)` from `../types` — the same helper the availability page uses. Honors Monday-start (or any day) facilities. Defaults to 0 (Sunday) when unset.
