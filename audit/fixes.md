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
