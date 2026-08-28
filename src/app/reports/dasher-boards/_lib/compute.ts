// Pure, dependency-free logic for the Dasher Boards module. No server-only
// imports here — this module is unit-tested by vitest (compute.test.ts) in a
// plain Node environment, mirroring reports/refrigeration/_lib/compute.ts.

export type AssetType = "board_panel" | "glass_panel" | "door" | "corner_radius" | "post_gap"
export type IssueSeverity = "a" | "b" | "c"
export type Cadence = "daily" | "weekly" | "monthly" | "yearly"
export type AssetCheckStatus = "pass" | "fail"

export const ASSET_TYPES: readonly AssetType[] = [
  "board_panel",
  "glass_panel",
  "door",
  "corner_radius",
  "post_gap",
] as const
export function isAssetType(v: string): v is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(v)
}

// Positioned types carry sequence_position; glass rides its parent position
// (mirrors the DB position_shape constraint, migration 259).
export const POSITIONED_ASSET_TYPES: readonly AssetType[] = [
  "board_panel",
  "door",
  "corner_radius",
  "post_gap",
] as const
export function isPositionedAssetType(v: AssetType): boolean {
  return (POSITIONED_ASSET_TYPES as readonly string[]).includes(v)
}

export const ISSUE_SEVERITIES: readonly IssueSeverity[] = ["a", "b", "c"] as const
export function isIssueSeverity(v: string): v is IssueSeverity {
  return (ISSUE_SEVERITIES as readonly string[]).includes(v)
}

export const CADENCES: readonly Cadence[] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const
export function isCadence(v: string): v is Cadence {
  return (CADENCES as readonly string[]).includes(v)
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v: string): boolean {
  return UUID_RE.test(v)
}

// ---------------------------------------------------------------------------
// Label allocation.
//
// Labels are permanent identity: numbers are allocated monotonically per type
// prefix and NEVER reused, even after the asset that held them is converted,
// relabeled, or removed — retired labels count toward the high-water mark.
// ---------------------------------------------------------------------------

export const LABEL_PREFIX: Record<AssetType, string> = {
  board_panel: "B",
  glass_panel: "G",
  door: "D",
  corner_radius: "C",
  post_gap: "P",
}

/**
 * Next available label for `assetType`, given every label that has ever been
 * used on the rink (live + retired). Scans ALL labels for the type's prefix
 * pattern — not just labels currently on rows of that type — so a converted
 * B12→D5 still blocks a future "B12" via the retired list, and a custom label
 * that happens to match the pattern still bumps the counter.
 */
export function nextLabel(
  assetType: AssetType,
  liveLabels: readonly string[],
  retiredLabels: readonly string[],
): string {
  const prefix = LABEL_PREFIX[assetType]
  const re = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const label of [...liveLabels, ...retiredLabels]) {
    const m = re.exec(label.trim())
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${max + 1}`
}

// ---------------------------------------------------------------------------
// Severity rollup: a > b > c. null = no open issues (clear).
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<IssueSeverity, number> = { a: 3, b: 2, c: 1 }

export function worstOpenSeverity(
  severities: readonly IssueSeverity[],
): IssueSeverity | null {
  let worst: IssueSeverity | null = null
  for (const s of severities) {
    if (worst === null || SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s
  }
  return worst
}

// ---------------------------------------------------------------------------
// Asset-check rollup: "latest" check per asset, plus the combined
// diagram/dashboard condition once an open-issue rollup is also known.
// ---------------------------------------------------------------------------

export type AssetCheckLite = {
  assetId: string
  status: AssetCheckStatus
  /** created_at, or updated_at when the check was later edited. */
  effectiveAt: string
}

/**
 * The current condition of one asset from its check history: the row with
 * the max `effectiveAt` wins — a later check supersedes an earlier one
 * regardless of which walk it came from (a Pass after a prior Fail reads as
 * Pass). Empty ⇒ null (never checked).
 */
export function latestCheckStatus(
  checks: readonly Pick<AssetCheckLite, "status" | "effectiveAt">[],
): AssetCheckStatus | null {
  let best: Pick<AssetCheckLite, "status" | "effectiveAt"> | null = null
  for (const c of checks) {
    if (!best || c.effectiveAt > best.effectiveAt) best = c
  }
  return best?.status ?? null
}

/**
 * Combine a board's own latest check with its glass child's latest check
 * into one segment-level status (a glass row has no diagram segment of its
 * own, so its condition rides on the board's). This is a DIFFERENT operation
 * from `latestCheckStatus`: that function supersedes by time WITHIN one
 * asset's own history (a later check on the SAME asset legitimately replaces
 * an earlier one). Board and glass are different physical pieces, so their
 * check histories must not be merged and re-sorted by time together — a Fail
 * on the board, still unaddressed, must not be masked just because the glass
 * happened to be checked (and passed) more recently. Fail wins over pass
 * wins over null, independent of which one is more recent.
 */
export function combineAssetAndChildCheckStatus(
  own: AssetCheckStatus | null,
  child: AssetCheckStatus | null,
): AssetCheckStatus | null {
  if (own === "fail" || child === "fail") return "fail"
  if (own === "pass" || child === "pass") return "pass"
  return null
}

/**
 * The diagram/dashboard's display condition for one asset, combining the
 * open-issue rollup with the latest condition check. An open issue (any
 * severity) is the actively-tracked, unresolved problem, so it always wins
 * over a bare Fail check. A Fail with no open issue is "flagged": surfaced
 * during a walk but not yet escalated into the issue pipeline — a distinct,
 * less-alarming state from an open severity-A/B/C issue, but still visibly
 * different from a clear asset. Neither present ⇒ null (clear).
 */
export function combineDisplayCondition(args: {
  worstOpenSeverity: IssueSeverity | null
  latestCheckStatus: AssetCheckStatus | null
}): "alert" | "warn" | "flagged" | null {
  const { worstOpenSeverity: severity, latestCheckStatus: check } = args
  if (severity === "a") return "alert"
  if (severity === "b" || severity === "c") return "warn"
  if (check === "fail") return "flagged"
  return null
}

// ---------------------------------------------------------------------------
// Cadence due-ness. All day keys are facility-local "YYYY-MM-DD" strings
// (dayKeyInTz); weekday math is pure calendar arithmetic (weekdayOfKey).
// ---------------------------------------------------------------------------

export type ChecklistItemLite = {
  id: string
  cadence: Cadence
  due_month: number | null
}

export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7)
}

export function monthNumberOf(dayKey: string): number {
  return Number(dayKey.slice(5, 7))
}

/**
 * Which items are due for a walk happening on `todayKey`?
 *  - daily:   always due.
 *  - weekly:  due when today's weekday matches the rink's inspection_weekday.
 *  - monthly: due when no completed walk exists yet in today's calendar month
 *             (the month's first walk carries the monthly items).
 *  - yearly:  due when today's month equals the item's due_month AND the item
 *             has not been answered in a completed walk this month.
 */
export function computeDueItemIds(args: {
  items: readonly ChecklistItemLite[]
  todayKey: string
  todayWeekday: number
  inspectionWeekday: number
  completedWalkDayKeys: readonly string[]
  answeredItemIdsThisMonth: ReadonlySet<string>
}): Set<string> {
  const {
    items,
    todayKey,
    todayWeekday,
    inspectionWeekday,
    completedWalkDayKeys,
    answeredItemIdsThisMonth,
  } = args
  const month = monthKeyOf(todayKey)
  const walkedThisMonth = completedWalkDayKeys.some(
    (k) => monthKeyOf(k) === month,
  )
  const due = new Set<string>()
  for (const item of items) {
    switch (item.cadence) {
      case "daily":
        due.add(item.id)
        break
      case "weekly":
        if (todayWeekday === inspectionWeekday) due.add(item.id)
        break
      case "monthly":
        if (!walkedThisMonth) due.add(item.id)
        break
      case "yearly":
        if (
          item.due_month !== null &&
          monthNumberOf(todayKey) === item.due_month &&
          !answeredItemIdsThisMonth.has(item.id)
        ) {
          due.add(item.id)
        }
        break
    }
  }
  return due
}

// ---------------------------------------------------------------------------
// Glass thickness display: decimal inches → nearest common fraction (16ths),
// e.g. 0.625 → 5/8", 1.25 → 1 1/4". Falls back to the decimal for values that
// don't sit on the 16ths grid (tolerance 0.01" — metric-converted specs like
// 15mm = 0.5906" stay decimal instead of being silently snapped).
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function thicknessToFraction(inches: number): string {
  if (!Number.isFinite(inches) || inches <= 0) return String(inches)
  const whole = Math.floor(inches)
  const frac = inches - whole
  const sixteenths = Math.round(frac * 16)
  if (Math.abs(frac - sixteenths / 16) > 0.01) {
    return String(inches)
  }
  if (sixteenths === 0) return String(whole)
  if (sixteenths === 16) return String(whole + 1)
  const d = gcd(sixteenths, 16)
  const fracStr = `${sixteenths / d}/${16 / d}`
  return whole > 0 ? `${whole} ${fracStr}` : fracStr
}
