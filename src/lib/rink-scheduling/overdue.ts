// Pure selection logic for the overdue-invoice reminder cron.
//
// Dependency-free on purpose: WHICH invoices get nagged, and how often, is the
// part of the reminder job worth pinning with unit tests — the cron route just
// applies these answers with a service client.

/** Whole days from `fromKey` to `toKey` (both YYYY-MM-DD). Positive when
 *  toKey is later. Parsed at UTC noon so a zone can never shift the count. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const parse = (k: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k)
    if (!m) return null
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
    return Number.isNaN(t) ? null : t
  }
  const from = parse(fromKey)
  const to = parse(toKey)
  if (from === null || to === null) return 0
  return Math.round((to - from) / 86_400_000)
}

/** Aging bucket label for reporting ("1–30 days", …). `days` >= 1. */
export function agingBucket(days: number): "1-30" | "31-60" | "61-90" | "90+" {
  if (days <= 30) return "1-30"
  if (days <= 60) return "31-60"
  if (days <= 90) return "61-90"
  return "90+"
}

export type ReminderCandidate = {
  /** Invoice status as stored. Only issued-and-unsettled statuses remind. */
  status: string
  /** YYYY-MM-DD due date. */
  dueDate: string
  /** ISO timestamp of the last reminder, or null if never reminded. */
  lastReminderAt: string | null
}

export type ReminderDecision =
  | { due: true; daysOverdue: number }
  | { due: false; reason: "not_open" | "not_overdue" | "too_soon" }

/**
 * Should this invoice be reminded about right now?
 *
 * - Only `sent` / `partially_paid` invoices are open balances; drafts were
 *   never issued, and paid/void owe nothing.
 * - Overdue means the facility-local TODAY is past the due date — due today is
 *   not overdue.
 * - The cadence is measured in real elapsed time from the last reminder, so a
 *   cron that fires twice (a retry, a manual run) cannot double-nag.
 */
export function decideReminder(
  candidate: ReminderCandidate,
  input: { todayKey: string; nowMs: number; cadenceDays: number },
): ReminderDecision {
  if (candidate.status !== "sent" && candidate.status !== "partially_paid") {
    return { due: false, reason: "not_open" }
  }

  const daysOverdue = daysBetweenKeys(candidate.dueDate, input.todayKey)
  if (daysOverdue < 1) return { due: false, reason: "not_overdue" }

  if (candidate.lastReminderAt !== null) {
    const last = Date.parse(candidate.lastReminderAt)
    if (
      Number.isFinite(last) &&
      input.nowMs - last < input.cadenceDays * 86_400_000
    ) {
      return { due: false, reason: "too_soon" }
    }
  }

  return { due: true, daysOverdue }
}
