# Facility schedule — performance test results (2026-09-15)

Harness: `src/app/reports/rink-scheduling/_lib/facility-schedule.bench.ts`, run with
`pnpm bench` (vitest bench, plain Node, no DB or network).
Machine: Node 22.22.2, Intel Xeon @ 2.80 GHz, 4 vCPU. A modern laptop is roughly
2–3× faster than these absolute numbers; the ratios are what matter.

Correctness baseline on the same commit: `pnpm test` 98 files / 1330 tests passed,
`pnpm typecheck` clean.

## What is measured

The rink-scheduling calendar loads an **unfiltered** window of the facility's
bookings — 34 days for day/week/agenda, the whole 42-cell grid for month
(`load-calendar.ts`: no rink filter, no row cap) — and every view then re-slices
that whole array in a plain component body. So the per-render cost is
O(rinks × days × bookings), and each element pays a facility-timezone conversion.

Three facility profiles, sized by booking count in the loaded window:

| Profile | Shape | Rows loaded (day/week/agenda) | Rows loaded (month) |
| --- | --- | --- | --- |
| quiet | 1 sheet × 10 bookings/day | 350 | 420 |
| busy | 3 sheets × 18 bookings/day | 1,890 | 2,268 |
| tournament | 4 sheets × 30 bookings/day | 4,200 | 5,040 |

## Results — current `main`

Mean milliseconds for one assembly pass (i.e. one React render of that view).

| View | quiet | busy | tournament |
| --- | --- | --- | --- |
| Day (all rinks + block geometry) | 75 ms | 345 ms | **882 ms** |
| Week (7 columns, one sheet) | 445 ms | 807 ms | **1,712 ms** |
| Month (`buildMonthGrid`, all rinks) | 189 ms | 1,020 ms | **2,837 ms** |
| Agenda (14 days) | 886 ms | 4,845 ms | **11,637 ms** |
| Front desk (`buildDeskAgenda`, one day) | — | — | 871 ms |

`findOpenStartsForDay` is not a problem: 249,000 ops/sec (0.004 ms) on a full
18-hour sheet with 30 blocked intervals. The open-slot search is fine.

## Root cause 1 — the Intl formatter is rebuilt on every conversion

`partsFormatter()` in `src/lib/timezone.ts` calls `new Intl.DateTimeFormat(...)`
on **every** invocation, and `partsInZone()` then does six `Array.find()` scans
over the returned parts. Constructing an `Intl.DateTimeFormat` is one of the most
expensive operations in the JS standard library.

| Helper | ops/sec | per call |
| --- | --- | --- |
| `dayKeyInTz` | 11,021 | 0.091 ms |
| `minutesOfDayInTz` | 12,146 | 0.082 ms |
| `bookingMinutesOnDay` (2× dayKey + 1× minutesOfDay) | 3,051 | 0.328 ms |
| same, with `timeZone = null` (no Intl path) | 775,134 | 0.0013 ms |

**254× between the zoned and unzoned paths.** Every booking-day the calendar
renders costs a third of a millisecond before any layout math happens.

This is not a rink-scheduling problem — `src/lib/timezone.ts` is used by staff
scheduling, notifications, exports, ICS feeds, PDF bodies, and the cron routes.
The calendar is just where it shows up first.

### Measured fix

Caching the formatter per IANA zone in a module-level `Map`, and replacing the
six `Array.find()` scans with one pass into a lookup object:

| Measurement | before | after | speedup |
| --- | --- | --- | --- |
| `dayKeyInTz` | 11,021/s | 119,965/s | 10.9× |
| `bookingMinutesOnDay` | 3,051/s | 33,454/s | 11.0× |
| Day view, tournament | 882 ms | 69 ms | 12.8× |
| Week view, tournament | 1,712 ms | 120 ms | 14.2× |
| Month view, tournament | 2,837 ms | 206 ms | 13.8× |
| Agenda view, tournament | 11,637 ms | 951 ms | 12.2× |
| Agenda view, busy | 4,845 ms | 433 ms | 11.2× |

The prototype passed the full suite unchanged (1330 tests) and `tsc --noEmit`.
Behavior is identical: an unresolvable zone still throws out of the constructor
inside each caller's existing `try`, because only successful constructions are
cached.

## Root cause 2 — O(rinks × days × bookings), re-run every render

Even with root cause 1 fixed, the agenda still costs ~950 ms at tournament scale,
because the shape of the work is unchanged:

- `WeekGrid` (`calendar-client.tsx:758`) runs `bookings.filter(b => b.rink_id === rink.id)`
  **inside** a 7-day `map` — the whole array is re-scanned seven times — and the
  body is a plain component body, not a `useMemo`, so it re-runs on every render,
  including each `startDragTransition` tick while a block is being dragged.
- `DayGrid` (`:604`) and `AgendaList` (`:1110`) have the same shape.
- The loader fetches every rink's bookings for a 34-day window even when the view
  renders one sheet for one day.

Candidate fixes, in the order I'd do them:

1. Bucket bookings by `(rink_id, dayKey)` once, in a `useMemo` keyed on `visible`,
   and have each column read its bucket. Turns rinks × days × bookings into a
   single pass.
2. Wrap the `columns` / `placed` assembly in `useMemo` so drag transitions and
   sheet open/close stop re-deriving the whole grid.
3. Narrow the day and week queries in `load-calendar.ts` to the days those views
   actually render (the month view already does this via `monthGridRange`).

## Reproducing

```bash
pnpm bench                       # all profiles, ~8 minutes
npx vitest bench --run -t "slice 14 days"   # one view
```
