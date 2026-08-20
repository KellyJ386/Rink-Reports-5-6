// The coverage sweep: re-evaluates every future booking at a facility and
// keeps its gap alerts in step.
//
// Runs with a SERVICE-ROLE client (from the cron wrapper), which bypasses RLS.
// That is required — it must read published shifts and write alerts on behalf
// of a facility with no user session — and it is why every query below carries
// an explicit facility_id predicate rather than relying on a policy to scope
// it.
//
// READ-ONLY towards Employee Scheduling. This module reads schedule_shifts and
// writes nothing back to any scheduling table.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database"

import {
  evaluateCoverage,
  describeCoverage,
  type CoverageStatus,
  type ExceptionRow,
  type HoursRow,
  type Interval,
} from "./coverage"

type Client = SupabaseClient<Database>

/** How far ahead a sweep looks. Past bookings cannot be fixed by rostering
 *  someone, so flagging them would be noise an admin can never clear. */
const HORIZON_DAYS = 120

export type FacilitySweepResult = {
  facilityId: string
  evaluated: number
  changed: number
  alertsOpened: number
  alertsResolved: number
  skipped?: string
}

export type SweepResult = {
  facilities: number
  evaluated: number
  changed: number
  alertsOpened: number
  alertsResolved: number
  details: FacilitySweepResult[]
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/**
 * Sweep one facility.
 *
 * The published-shift query is the enforcement point for "published": RLS does
 * NOT filter drafts for admin-grant holders, and a cancelled shift keeps its
 * published_at stamp. So the predicate is `status = 'published'` — never
 * `published_at is not null`, never `status <> 'draft'`.
 */
export async function sweepFacility(
  supabase: Client,
  facilityId: string,
): Promise<FacilitySweepResult> {
  const empty: FacilitySweepResult = {
    facilityId,
    evaluated: 0,
    changed: 0,
    alertsOpened: 0,
    alertsResolved: 0,
  }

  const { data: settings } = await supabase
    .from("rink_scheduling_settings")
    .select("coverage_check_enabled")
    .eq("facility_id", facilityId)
    .maybeSingle()

  // An admin who turned the check off should stop getting alerts, not merely
  // stop seeing new ones, so existing open alerts are resolved on the way out.
  if (settings && settings.coverage_check_enabled === false) {
    const resolved = await resolveAllOpenAlerts(supabase, facilityId)
    return { ...empty, alertsResolved: resolved, skipped: "coverage check disabled" }
  }

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone, name")
    .eq("id", facilityId)
    .maybeSingle()
  const timeZone = facility?.timezone ?? null

  const nowIso = new Date().toISOString()
  const horizonIso = isoDaysFromNow(HORIZON_DAYS)

  const [bookingsRes, hoursRes, exceptionsRes, shiftsRes, rinksRes] =
    await Promise.all([
      supabase
        .from("rink_bookings")
        .select(
          "id, rink_id, title, starts_at, ends_at, blocks_until, coverage_status, customer_id",
        )
        .eq("facility_id", facilityId)
        .neq("status", "cancelled")
        .gte("starts_at", nowIso)
        .lte("starts_at", horizonIso)
        .order("starts_at", { ascending: true }),
      supabase.from("facility_operating_hours").select("*").eq("facility_id", facilityId),
      supabase
        .from("facility_operating_hours_exceptions")
        .select("*")
        .eq("facility_id", facilityId),
      // status = 'published' is the authoritative predicate. See the header.
      supabase
        .from("schedule_shifts")
        .select("starts_at, ends_at")
        .eq("facility_id", facilityId)
        .eq("status", "published")
        .not("employee_id", "is", null)
        .gte("ends_at", nowIso)
        .lte("starts_at", horizonIso),
      supabase.from("facility_rinks").select("id, name").eq("facility_id", facilityId),
    ])

  const bookings = bookingsRes.data ?? []
  if (bookings.length === 0) {
    // Nothing ahead: clear any alert left over from bookings that have since
    // been cancelled or have passed.
    const resolved = await resolveAllOpenAlerts(supabase, facilityId)
    return { ...empty, alertsResolved: resolved }
  }

  const hours = (hoursRes.data ?? []) as HoursRow[]
  const exceptions = (exceptionsRes.data ?? []) as ExceptionRow[]
  const shifts: Interval[] = (shiftsRes.data ?? []).map((s) => ({
    startMs: new Date(s.starts_at).getTime(),
    endMs: new Date(s.ends_at).getTime(),
  }))
  const rinkName = new Map((rinksRes.data ?? []).map((r) => [r.id, r.name]))

  let changed = 0
  let alertsOpened = 0
  let alertsResolved = 0
  const stillGapped = new Set<string>()
  const newlyGapped: NewGap[] = []

  for (const booking of bookings) {
    const status: CoverageStatus = evaluateCoverage({
      startsAtMs: new Date(booking.starts_at).getTime(),
      blocksUntilMs: new Date(booking.blocks_until).getTime(),
      timeZone,
      hours,
      exceptions,
      publishedShifts: shifts,
    })

    if (status !== booking.coverage_status) {
      const { error } = await supabase
        .from("rink_bookings")
        .update({ coverage_status: status, coverage_checked_at: new Date().toISOString() })
        .eq("id", booking.id)
        .eq("facility_id", facilityId)
      if (!error) changed++
    }

    if (status === "covered") continue

    stillGapped.add(booking.id)
    const opened = await upsertGapAlert(supabase, {
      facilityId,
      bookingId: booking.id,
      title: booking.title ?? "Booking",
      rinkName: rinkName.get(booking.rink_id) ?? "the rink",
      startsAt: booking.starts_at,
      status,
      timeZone,
    })
    if (opened) {
      alertsOpened++
      newlyGapped.push({
        title: booking.title ?? "Booking",
        rinkName: rinkName.get(booking.rink_id) ?? "the rink",
        when: formatWhen(booking.starts_at, timeZone),
        status,
      })
    }
  }

  // Notify only about gaps that are NEW this pass. A booking that has been
  // flagged for a week must not re-notify every five minutes; the standing
  // alert already represents it.
  if (newlyGapped.length > 0) {
    await notifyManagers(supabase, facilityId, facility?.name ?? "the facility", newlyGapped)
  }

  // A gap that has since been filled must CLEAR. Resolving rather than
  // deleting keeps the history of what was flagged and when.
  alertsResolved = await resolveAlertsExcept(supabase, facilityId, stillGapped)

  return {
    facilityId,
    evaluated: bookings.length,
    changed,
    alertsOpened,
    alertsResolved,
  }
}

/**
 * Open or refresh the alert for one gapped booking.
 *
 * communication_alerts_rink_scheduling_open_uniq (migration 252) means at most
 * one UNRESOLVED alert exists per booking, so a sweep every five minutes
 * updates the existing row instead of growing a new one each time. Returns
 * true only when a genuinely new alert was created, so the caller can count
 * what an admin will actually be told about.
 */
async function upsertGapAlert(
  supabase: Client,
  input: {
    facilityId: string
    bookingId: string
    title: string
    rinkName: string
    startsAt: string
    status: CoverageStatus
    timeZone: string | null
  },
): Promise<boolean> {
  const when = formatWhen(input.startsAt, input.timeZone)
  const body =
    `${input.title} on ${input.rinkName} at ${when} ${describeCoverage(input.status)}. ` +
    `Open the rink schedule to adjust the booking, or Employee Scheduling to roster cover.`

  const { data: existing } = await supabase
    .from("communication_alerts")
    .select("id, body")
    .eq("facility_id", input.facilityId)
    .eq("source_module", "rink_scheduling")
    .eq("source_record_id", input.bookingId)
    .is("resolved_at", null)
    .maybeSingle()

  if (existing) {
    // The reason can change (hours gap becomes a staffing gap), so refresh the
    // text without reopening or duplicating the alert.
    if (existing.body !== body) {
      await supabase
        .from("communication_alerts")
        .update({ body, severity: severityFor(input.status) })
        .eq("id", existing.id)
        .eq("facility_id", input.facilityId)
    }
    return false
  }

  const { error } = await supabase.from("communication_alerts").insert({
    facility_id: input.facilityId,
    source_module: "rink_scheduling",
    source_record_id: input.bookingId,
    severity: severityFor(input.status),
    title: "Ice booked without cover",
    body,
    requires_acknowledgement: false,
  })

  // A unique-violation here means a concurrent sweep won the race, which is
  // exactly what the index is for — not an error worth reporting.
  return !error
}

function severityFor(status: CoverageStatus): string {
  // Both gaps at once means an out-of-hours booking with nobody rostered:
  // the case most likely to end with a locked building and a paying customer
  // outside it.
  return status === "gap_both" ? "high" : "warn"
}

function formatWhen(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone ?? undefined,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

async function resolveAlertsExcept(
  supabase: Client,
  facilityId: string,
  keepOpen: Set<string>,
): Promise<number> {
  const { data: open } = await supabase
    .from("communication_alerts")
    .select("id, source_record_id")
    .eq("facility_id", facilityId)
    .eq("source_module", "rink_scheduling")
    .is("resolved_at", null)

  const toResolve = (open ?? [])
    .filter((a) => a.source_record_id && !keepOpen.has(a.source_record_id))
    .map((a) => a.id)
  if (toResolve.length === 0) return 0

  const { error } = await supabase
    .from("communication_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("facility_id", facilityId)
    .in("id", toResolve)
  return error ? 0 : toResolve.length
}

async function resolveAllOpenAlerts(
  supabase: Client,
  facilityId: string,
): Promise<number> {
  return resolveAlertsExcept(supabase, facilityId, new Set())
}

/**
 * Drain the queue.
 *
 * Claims each pending row before working it, so an overlapping run cannot
 * double-sweep the same facility. The queue's partial unique index means a
 * publish of any size leaves exactly one row to claim.
 */
export async function runCoverageSweep(
  supabase: Client,
  options: { maxFacilities?: number } = {},
): Promise<SweepResult> {
  const max = options.maxFacilities ?? 25

  const { data: pending } = await supabase
    .from("rink_coverage_reeval_queue")
    .select("id, facility_id")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(max)

  const rows = pending ?? []
  const details: FacilitySweepResult[] = []

  for (const row of rows) {
    // Mark done FIRST. A sweep that crashes mid-facility should not wedge the
    // queue; the next scheduled run picks the facility up anyway, and any new
    // change re-enqueues it.
    await supabase
      .from("rink_coverage_reeval_queue")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("id", row.id)

    details.push(await sweepFacility(supabase, row.facility_id))
  }

  return {
    facilities: details.length,
    evaluated: details.reduce((n, d) => n + d.evaluated, 0),
    changed: details.reduce((n, d) => n + d.changed, 0),
    alertsOpened: details.reduce((n, d) => n + d.alertsOpened, 0),
    alertsResolved: details.reduce((n, d) => n + d.alertsResolved, 0),
    details,
  }
}


type NewGap = {
  title: string
  rinkName: string
  when: string
  status: CoverageStatus
}

/**
 * Tell the people who can actually fix it.
 *
 * Recipients are resolved by PERMISSION, not by role key: anyone holding the
 * module's `edit` or `admin` grant at this facility. That is the spec's
 * "facility_manager and above" expressed in the model this codebase really
 * uses, and it keeps working when a facility invents a custom role.
 *
 * One message per sweep listing the new gaps, rather than one per booking:
 * publishing a roster can flag a dozen bookings at once, and a dozen separate
 * emails would train people to ignore them.
 *
 * Writes into notification_outbox, which the existing drain + send crons carry
 * the rest of the way. Best-effort: a notification failure must not fail the
 * sweep, whose primary job is keeping coverage_status truthful.
 */
async function notifyManagers(
  supabase: Client,
  facilityId: string,
  facilityName: string,
  gaps: NewGap[],
): Promise<void> {
  try {
    const { data: grants } = await supabase
      .from("user_permissions")
      .select("user_id")
      .eq("facility_id", facilityId)
      .eq("module_name", "rink_scheduling")
      .in("action", ["edit", "admin"])
      .eq("enabled", true)

    const userIds = Array.from(new Set((grants ?? []).map((g) => g.user_id)))
    if (userIds.length === 0) return

    const { data: employees } = await supabase
      .from("employees")
      .select("id")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .in("user_id", userIds)

    const recipients = (employees ?? []).map((e) => e.id)
    if (recipients.length === 0) return

    const shown = gaps.slice(0, 10)
    const lines = shown.map(
      (g) => `• ${g.title} — ${g.rinkName}, ${g.when}: ${describeCoverage(g.status)}`,
    )
    if (gaps.length > shown.length) {
      lines.push(`• …and ${gaps.length - shown.length} more`)
    }

    const subject =
      gaps.length === 1
        ? "Ice booked without cover"
        : `${gaps.length} bookings without cover`

    const body =
      `${facilityName} has ice booked that nothing currently covers:\n\n` +
      lines.join("\n") +
      `\n\nOpen the rink schedule to adjust the booking, or Employee Scheduling ` +
      `to roster cover. This is a notification only — no shifts have been created.`

    await supabase.from("notification_outbox").insert(
      recipients.map((employeeId) => ({
        facility_id: facilityId,
        source_module: "rink_scheduling",
        recipient_employee_id: employeeId,
        subject,
        body,
        status: "pending",
      })),
    )
  } catch {
    // Best-effort: keeping coverage_status truthful matters more than the note.
  }
}
