import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildLineDescription,
  centsToAmount,
  computeTotals,
  lineAmountCents,
  toCents,
} from "@/lib/rink-scheduling/ar"
import type { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database"
import { addDaysToKey, dayKeyInTz, formatInTz, wallTimeToUtc } from "@/lib/timezone"

// Accepts the RLS-scoped server client (biller-facing actions) AND the
// service-role client (the season-contract cron). The service caller is why
// every query filters explicitly by facility rather than trusting a policy.
type DbClient = Awaited<ReturnType<typeof createClient>> | SupabaseClient<Database>

export type BillableBooking = {
  id: string
  /** Series this booking was expanded from, if any — how a season contract
   *  decides which of a customer's bookings it covers. */
  seriesId: string | null
  startsAt: string
  endsAt: string
  dayKey: string
  timeRange: string
  rinkName: string
  typeName: string
  hours: number
  rateSnapshot: number | null
  /** The booking's quoted total (computed_amount), which is the ONLY correct
   *  billing figure for a booking that straddles a prime boundary — the rate
   *  engine deliberately nulls the hourly snapshot for those and puts the
   *  blended charge here. Null means the booking was never priced (no rate
   *  card covered its date). */
  amount: number | null
}

/**
 * Billable, non-cancelled bookings for a customer in a window that are not
 * already on a live invoice.
 *
 * "Not already invoiced" is decided by asking which booking ids appear on
 * NON-VOID line items, which is the same rule the partial unique index
 * enforces — so what this offers and what the database will accept cannot
 * drift apart.
 *
 * Extracted from the invoices server action so the season-contract cron
 * generates from the SAME definition of billable a biller sees on screen.
 */
export async function listUninvoicedBookingsCore(
  supabase: DbClient,
  facilityId: string,
  input: { customerId: string; fromDayKey: string; toDayKey: string },
): Promise<{ ok: true; bookings: BillableBooking[] } | { ok: false; error: string }> {
  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", facilityId)
    .maybeSingle()
  const timeZone = facility?.timezone ?? null

  const { data: rows } = await supabase
    .from("rink_bookings")
    .select(
      "id, series_id, starts_at, ends_at, computed_amount, rate_snapshot_hourly, rink_id, booking_type_id, status",
    )
    .eq("facility_id", facilityId)
    .eq("customer_id", input.customerId)
    .neq("status", "cancelled")
    // Facility-local day keys become facility-midnight instants; a "Z"-glued
    // key shifted the window hours early and clipped evening bookings on
    // its edge days.
    .gte(
      "starts_at",
      wallTimeToUtc(`${input.fromDayKey}T00:00`, timeZone)?.toISOString() ??
        `${input.fromDayKey}T00:00:00.000Z`,
    )
    .lt(
      "starts_at",
      wallTimeToUtc(`${addDaysToKey(input.toDayKey, 1)}T00:00`, timeZone)?.toISOString() ??
        `${input.toDayKey}T23:59:59.999Z`,
    )
    .order("starts_at", { ascending: true })

  const bookings = rows ?? []
  if (bookings.length === 0) return { ok: true, bookings: [] }

  const [{ data: lines }, { data: rinks }, { data: types }] = await Promise.all([
    supabase
      .from("rink_invoice_line_items")
      .select("booking_id")
      .eq("facility_id", facilityId)
      .eq("voided", false)
      .in("booking_id", bookings.map((b) => b.id)),
    supabase.from("facility_rinks").select("id, name").eq("facility_id", facilityId),
    supabase
      .from("rink_booking_types")
      .select("id, name, is_billable")
      .eq("facility_id", facilityId),
  ])

  const invoiced = new Set((lines ?? []).map((l) => l.booking_id))
  const rinkName = new Map((rinks ?? []).map((r) => [r.id, r.name]))
  const typeById = new Map((types ?? []).map((t) => [t.id, t]))

  const out: BillableBooking[] = []
  for (const b of bookings) {
    if (invoiced.has(b.id)) continue
    const type = typeById.get(b.booking_type_id)
    // A Maintenance Block occupies ice but never reaches an invoice.
    if (!type?.is_billable) continue

    const hours =
      (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 3_600_000
    const timeRange = `${formatInTz(b.starts_at, timeZone, { hour: "numeric", minute: "2-digit" })} – ${formatInTz(b.ends_at, timeZone, { hour: "numeric", minute: "2-digit" })}`

    out.push({
      id: b.id,
      seriesId: b.series_id,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      dayKey: dayKeyInTz(b.starts_at, timeZone),
      timeRange,
      rinkName: rinkName.get(b.rink_id) ?? "Rink",
      typeName: type?.name ?? "Booking",
      hours: Number(hours.toFixed(2)),
      rateSnapshot: b.rate_snapshot_hourly === null ? null : Number(b.rate_snapshot_hourly),
      amount: b.computed_amount === null ? null : Number(b.computed_amount),
    })
  }

  return { ok: true, bookings: out }
}

export type GenerateInvoiceInput = {
  customerId: string
  /** Must be drawn from listUninvoicedBookingsCore for the same customer. */
  bookings: BillableBooking[]
  issueDate: string
  notes: string | null
  employeeId: string | null
  /** Season contract this invoice is generated under, for provenance. */
  contractId?: string | null
}

/**
 * Create a draft invoice from already-selected billable bookings.
 *
 * Extracted verbatim from the invoices server action (numbering CAS loop,
 * quoted-amount billing, rollback on a lost line race) so the cron and the
 * biller produce byte-identical documents. The caller supplies the bookings
 * (already filtered), so this function never re-decides billability.
 */
export async function generateInvoiceCore(
  supabase: DbClient,
  facilityId: string,
  input: GenerateInvoiceInput,
): Promise<{ ok: true; invoiceId: string; number: string } | { ok: false; error: string }> {
  if (input.bookings.length === 0) {
    return { ok: false, error: "Select at least one booking to invoice." }
  }

  const [{ data: settings }, { data: customer }] = await Promise.all([
    supabase
      .from("rink_scheduling_settings")
      .select("invoice_prefix, tax_rate, default_payment_terms_days")
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("rink_customers")
      .select("payment_terms_days")
      .eq("facility_id", facilityId)
      .eq("id", input.customerId)
      .maybeSingle(),
  ])

  const prefix = settings?.invoice_prefix ?? "INV-"
  // Tax is SNAPSHOTTED onto the invoice, so a later settings change never
  // restates a document already issued.
  const taxRate =
    settings?.tax_rate === null || settings?.tax_rate === undefined
      ? null
      : Number(settings.tax_rate)
  const terms = customer?.payment_terms_days ?? settings?.default_payment_terms_days ?? 30

  const dueDate = new Date(
    new Date(`${input.issueDate}T00:00:00Z`).getTime() + terms * 86_400_000,
  )
    .toISOString()
    .slice(0, 10)

  // Claim the next number with an optimistic compare-and-set loop.
  // supabase-js cannot express `next_seq = next_seq + 1`, so the previous
  // read-then-upsert was a TOCTOU: two concurrent generations both read N,
  // both wrote N+1, and both tried the same invoice number (the second
  // failing on the unique index with a raw duplicate-key error) — and a
  // stalled request could even REGRESS the counter below already-issued
  // numbers. Here the advance only lands if next_seq is still the value we
  // read (`.eq("next_seq", ...)`); a lost race matches zero rows and we
  // re-read. The unique index on invoice numbers stays as the backstop.
  let seq: number | null = null
  for (let attempt = 0; attempt < 5 && seq === null; attempt++) {
    const { data: counter, error: counterError } = await supabase
      .from("rink_invoice_counters")
      .select("next_seq")
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (counterError) {
      return { ok: false, error: "Could not read the invoice counter." }
    }

    if (!counter) {
      // First invoice ever: seed the counter at 2, claiming 1. A concurrent
      // seeder loses on the primary key (23505) and loops to CAS instead.
      const { error: seedError } = await supabase
        .from("rink_invoice_counters")
        .insert({ facility_id: facilityId, next_seq: 2 })
      if (!seedError) seq = 1
      else if (seedError.code !== "23505") {
        return { ok: false, error: "Could not reserve an invoice number." }
      }
      continue
    }

    const { data: claimed, error: bumpError } = await supabase
      .from("rink_invoice_counters")
      .update({ next_seq: counter.next_seq + 1 })
      .eq("facility_id", facilityId)
      .eq("next_seq", counter.next_seq)
      .select("facility_id")
    if (bumpError) {
      return { ok: false, error: "Could not reserve an invoice number." }
    }
    if ((claimed ?? []).length > 0) seq = counter.next_seq
  }
  if (seq === null) {
    return { ok: false, error: "The invoice counter is busy — try again." }
  }
  const invoiceNumber = `${prefix}${String(seq).padStart(4, "0")}`

  // Bill the QUOTED amount snapshotted onto the booking, never a recompute.
  // Recomputing hours x snapshot had two failure modes: a booking straddling
  // a prime boundary has rateSnapshot null by design (the blended charge
  // lives in computed_amount), so it was billed at hours x 0 = $0.00; and
  // hours is rounded to 2dp for display, so even uniform-rate bookings
  // drifted from their quote (50 min at $300/h: quoted $250.00, recomputed
  // 0.83 x 300 = $249.00). The hours x snapshot recompute survives only as
  // the fallback for legacy rows that predate computed_amount.
  const lineAmounts = input.bookings.map((b) =>
    b.amount !== null
      ? toCents(b.amount)
      : lineAmountCents({ quantityHours: b.hours, unitRate: b.rateSnapshot ?? 0 }),
  )
  const totals = computeTotals(lineAmounts, taxRate)

  const { data: invoice, error: invoiceError } = await supabase
    .from("rink_invoices")
    .insert({
      facility_id: facilityId,
      customer_id: input.customerId,
      invoice_number: invoiceNumber,
      status: "draft",
      issue_date: input.issueDate,
      due_date: dueDate,
      subtotal: centsToAmount(totals.subtotalCents),
      tax_amount: centsToAmount(totals.taxCents),
      total: centsToAmount(totals.totalCents),
      amount_paid: 0,
      tax_rate: taxRate,
      notes: input.notes,
      created_by: input.employeeId,
      contract_id: input.contractId ?? null,
    })
    .select("id")
    .maybeSingle()

  if (invoiceError || !invoice) {
    return { ok: false, error: invoiceError?.message ?? "Failed to create the invoice." }
  }

  const { error: linesError } = await supabase.from("rink_invoice_line_items").insert(
    input.bookings.map((b, i) => ({
      facility_id: facilityId,
      invoice_id: invoice.id,
      booking_id: b.id,
      description: buildLineDescription({
        typeName: b.typeName,
        rinkName: b.rinkName,
        dayKey: b.dayKey,
        timeRange: b.timeRange,
      }),
      quantity_hours: b.hours,
      // A blended booking has no single hourly rate; showing 0/hr next to a
      // real amount reads as an error on the PDF, so derive the effective
      // rate from what is actually billed.
      unit_rate:
        b.rateSnapshot ??
        (b.hours > 0 ? centsToAmount(Math.round(lineAmounts[i] / b.hours)) : 0),
      amount: centsToAmount(lineAmounts[i]),
      sort_order: i,
    })),
  )

  if (linesError) {
    // The partial unique index refused a booking that reached a live invoice
    // between the read and the write. Roll the draft back rather than leave a
    // half-built document behind. The RLS delete policy on rink_invoices is
    // super-admin-only, so for an ordinary biller's session client the
    // delete matches ZERO rows — fall back to voiding the orphan (an update
    // the edit tier holds), which releases nothing (it has no lines) but
    // leaves an honest, visible record instead of a phantom draft.
    const { data: deleted } = await supabase
      .from("rink_invoices")
      .delete()
      .eq("id", invoice.id)
      .eq("facility_id", facilityId)
      .select("id")
    if ((deleted ?? []).length === 0) {
      await supabase
        .from("rink_invoices")
        .update({
          status: "void",
          voided_at: new Date().toISOString(),
          void_reason: "Generation failed before any line landed; number consumed, nothing owed.",
        })
        .eq("id", invoice.id)
        .eq("facility_id", facilityId)
    }
    if (linesError.code === "23505") {
      return {
        ok: false,
        error: "One of those bookings was invoiced a moment ago. Reload and try again.",
      }
    }
    return { ok: false, error: linesError.message || "Failed to add invoice lines." }
  }

  return { ok: true, invoiceId: invoice.id, number: invoiceNumber }
}
