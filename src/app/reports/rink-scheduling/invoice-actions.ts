"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import {
  buildLineDescription,
  centsToAmount,
  checkPayment,
  computeTotals,
  deriveStatus,
  lineAmountCents,
  toCents,
  type InvoiceStatus,
} from "@/lib/rink-scheduling/ar"
import { createClient } from "@/lib/supabase/server"
import { addDaysToKey, dayKeyInTz, formatInTz, wallTimeToUtc } from "@/lib/timezone"

import type { SimpleResult } from "./_lib/types"

const AR_PATH = "/reports/rink-scheduling/invoices"

// ---------------------------------------------------------------------------
// Guard. Invoicing and AR are edit-tier throughout ("Create/send/void
// invoices, record payments" and "View AR reports" in the RBAC matrix).
// facility_id always comes from the session.
// ---------------------------------------------------------------------------

async function requireBiller(): Promise<
  { ok: true; facilityId: string; employeeId: string | null } | { ok: false; error: string }
> {
  await requireUser()
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile?.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }

  const supabase = await createClient()
  if (!(await currentUserCan(supabase, "rink_scheduling", "edit"))) {
    return {
      ok: false,
      error: "Invoicing needs the Rink Scheduling edit permission.",
    }
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", current!.authUser.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .maybeSingle()

  return { ok: true, facilityId: profile.facility_id, employeeId: employee?.id ?? null }
}

function caught(e: unknown): { ok: false; error: string } {
  logServerError("reports/rink-scheduling/invoice-actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

// ---------------------------------------------------------------------------
// Uninvoiced bookings
// ---------------------------------------------------------------------------

export type BillableBooking = {
  id: string
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
 */
export async function listUninvoicedBookings(input: {
  customerId: string
  fromDayKey: string
  toDayKey: string
}): Promise<{ ok: true; bookings: BillableBooking[] } | { ok: false; error: string }> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const timeZone = await getFacilityTimezone(supabase, ctx.facilityId)

    const { data: rows } = await supabase
      .from("rink_bookings")
      .select(
        "id, starts_at, ends_at, computed_amount, rate_snapshot_hourly, rink_id, booking_type_id, status",
      )
      .eq("facility_id", ctx.facilityId)
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
        .eq("facility_id", ctx.facilityId)
        .eq("voided", false)
        .in("booking_id", bookings.map((b) => b.id)),
      supabase.from("facility_rinks").select("id, name").eq("facility_id", ctx.facilityId),
      supabase
        .from("rink_booking_types")
        .select("id, name, is_billable")
        .eq("facility_id", ctx.facilityId),
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
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Generate a draft invoice
// ---------------------------------------------------------------------------

export async function generateInvoice(input: {
  customerId: string
  bookingIds: string[]
  issueDate: string
  notes: string | null
}): Promise<{ ok: true; invoiceId: string; number: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }
    if (input.bookingIds.length === 0) {
      return { ok: false, error: "Select at least one booking to invoice." }
    }

    // Line descriptions carry facility-local dates and times, but they are
    // built by listUninvoicedBookings, which resolves the zone itself.
    const supabase = await createClient()

    const [{ data: settings }, { data: customer }] = await Promise.all([
      supabase
        .from("rink_scheduling_settings")
        .select("invoice_prefix, tax_rate, default_payment_terms_days")
        .eq("facility_id", ctx.facilityId)
        .maybeSingle(),
      supabase
        .from("rink_customers")
        .select("payment_terms_days")
        .eq("facility_id", ctx.facilityId)
        .eq("id", input.customerId)
        .maybeSingle(),
    ])

    const prefix = settings?.invoice_prefix ?? "INV-"
    // Tax is SNAPSHOTTED onto the invoice, so a later settings change never
    // restates a document already issued.
    const taxRate = settings?.tax_rate === null || settings?.tax_rate === undefined
      ? null
      : Number(settings.tax_rate)
    const terms =
      customer?.payment_terms_days ?? settings?.default_payment_terms_days ?? 30

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
        .eq("facility_id", ctx.facilityId)
        .maybeSingle()
      if (counterError) {
        return { ok: false, error: "Could not read the invoice counter." }
      }

      if (!counter) {
        // First invoice ever: seed the counter at 2, claiming 1. A concurrent
        // seeder loses on the primary key (23505) and loops to CAS instead.
        const { error: seedError } = await supabase
          .from("rink_invoice_counters")
          .insert({ facility_id: ctx.facilityId, next_seq: 2 })
        if (!seedError) seq = 1
        else if (seedError.code !== "23505") {
          return { ok: false, error: "Could not reserve an invoice number." }
        }
        continue
      }

      const { data: claimed, error: bumpError } = await supabase
        .from("rink_invoice_counters")
        .update({ next_seq: counter.next_seq + 1 })
        .eq("facility_id", ctx.facilityId)
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

    const available = await listUninvoicedBookings({
      customerId: input.customerId,
      fromDayKey: "1900-01-01",
      toDayKey: "2999-12-31",
    })
    if (!available.ok) return { ok: false, error: available.error }

    const selected = available.bookings.filter((b) => input.bookingIds.includes(b.id))
    if (selected.length === 0) {
      return {
        ok: false,
        error: "Those bookings are no longer available to invoice — they may already be on one.",
      }
    }

    // Bill the QUOTED amount snapshotted onto the booking, never a recompute.
    // Recomputing hours x snapshot had two failure modes: a booking straddling
    // a prime boundary has rateSnapshot null by design (the blended charge
    // lives in computed_amount), so it was billed at hours x 0 = $0.00; and
    // hours is rounded to 2dp for display, so even uniform-rate bookings
    // drifted from their quote (50 min at $300/h: quoted $250.00, recomputed
    // 0.83 x 300 = $249.00). The hours x snapshot recompute survives only as
    // the fallback for legacy rows that predate computed_amount.
    const lineAmounts = selected.map((b) =>
      b.amount !== null
        ? toCents(b.amount)
        : lineAmountCents({ quantityHours: b.hours, unitRate: b.rateSnapshot ?? 0 }),
    )
    const totals = computeTotals(lineAmounts, taxRate)

    const { data: invoice, error: invoiceError } = await supabase
      .from("rink_invoices")
      .insert({
        facility_id: ctx.facilityId,
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
        created_by: ctx.employeeId,
      })
      .select("id")
      .maybeSingle()

    if (invoiceError || !invoice) {
      return { ok: false, error: invoiceError?.message ?? "Failed to create the invoice." }
    }

    const { error: linesError } = await supabase.from("rink_invoice_line_items").insert(
      selected.map((b, i) => ({
        facility_id: ctx.facilityId,
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
      // half-built document behind.
      await supabase
        .from("rink_invoices")
        .delete()
        .eq("id", invoice.id)
        .eq("facility_id", ctx.facilityId)
      if (linesError.code === "23505") {
        return {
          ok: false,
          error: "One of those bookings was invoiced a moment ago. Reload and try again.",
        }
      }
      return { ok: false, error: linesError.message || "Failed to add invoice lines." }
    }

    revalidatePath(AR_PATH)
    return { ok: true, invoiceId: invoice.id, number: invoiceNumber }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Manual line items (draft only — the RLS policy enforces this too)
// ---------------------------------------------------------------------------

export async function addManualLine(input: {
  invoiceId: string
  description: string
  quantityHours: number
  unitRate: number
}): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const description = input.description.trim()
    if (!description) return { ok: false, error: "Describe what this line is for." }
    if (!(input.quantityHours > 0)) {
      return { ok: false, error: "Quantity must be greater than zero." }
    }
    if (!(input.unitRate >= 0)) {
      return { ok: false, error: "Rate cannot be negative." }
    }

    const supabase = await createClient()
    const amountCents = lineAmountCents({
      quantityHours: input.quantityHours,
      unitRate: input.unitRate,
    })

    const { error } = await supabase.from("rink_invoice_line_items").insert({
      facility_id: ctx.facilityId,
      invoice_id: input.invoiceId,
      booking_id: null,
      description,
      quantity_hours: input.quantityHours,
      unit_rate: input.unitRate,
      amount: centsToAmount(amountCents),
      sort_order: 999,
    })
    if (error) {
      return {
        ok: false,
        error: "Could not add the line. Lines can only be changed while the invoice is a draft.",
      }
    }

    await recomputeInvoice(input.invoiceId, ctx.facilityId)
    revalidatePath(AR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

export async function deleteLine(
  invoiceId: string,
  lineId: string,
): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    // The recompute below trusts that lineId belonged to invoiceId, so the
    // delete must enforce that pairing — without it, deleting invoice A's
    // line while naming invoice B desyncs A's cached totals from its lines.
    const { data: removed, error } = await supabase
      .from("rink_invoice_line_items")
      .delete()
      .eq("id", lineId)
      .eq("invoice_id", invoiceId)
      .eq("facility_id", ctx.facilityId)
      .select("id")
    if (error) {
      return {
        ok: false,
        error: "Could not remove the line. Lines can only be changed while the invoice is a draft.",
      }
    }
    if ((removed ?? []).length === 0) {
      return {
        ok: false,
        error: "That line is not on this invoice, or the invoice is no longer a draft.",
      }
    }

    await recomputeInvoice(invoiceId, ctx.facilityId)
    revalidatePath(AR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

/** Recompute stored totals from the lines. Called after any line change; the
 *  invoice's own columns are a cache of this sum. */
async function recomputeInvoice(invoiceId: string, facilityId: string): Promise<void> {
  const supabase = await createClient()
  const [{ data: invoice }, { data: lines }] = await Promise.all([
    supabase
      .from("rink_invoices")
      .select("tax_rate")
      .eq("id", invoiceId)
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("rink_invoice_line_items")
      .select("amount")
      .eq("invoice_id", invoiceId)
      .eq("facility_id", facilityId),
  ])

  const taxRate =
    invoice?.tax_rate === null || invoice?.tax_rate === undefined
      ? null
      : Number(invoice.tax_rate)
  const totals = computeTotals(
    (lines ?? []).map((l) => toCents(l.amount)),
    taxRate,
  )

  await supabase
    .from("rink_invoices")
    .update({
      subtotal: centsToAmount(totals.subtotalCents),
      tax_amount: centsToAmount(totals.taxCents),
      total: centsToAmount(totals.totalCents),
    })
    .eq("id", invoiceId)
    .eq("facility_id", facilityId)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function sendInvoice(invoiceId: string): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: invoice } = await supabase
      .from("rink_invoices")
      .select("status, total, amount_paid")
      .eq("id", invoiceId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!invoice) return { ok: false, error: "Invoice not found." }
    if (invoice.status !== "draft") {
      return { ok: false, error: "Only a draft invoice can be sent." }
    }

    // Sending locks the lines (RLS admits line writes only on a draft), so the
    // derived status is computed from here on.
    const status = deriveStatus(
      "sent",
      toCents(invoice.total),
      toCents(invoice.amount_paid),
    )

    const { error } = await supabase
      .from("rink_invoices")
      .update({ status, sent_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .eq("facility_id", ctx.facilityId)
    if (error) return { ok: false, error: error.message || "Failed to send the invoice." }

    revalidatePath(AR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

/**
 * Voiding is what releases an invoice's bookings back to uninvoiced: the
 * trigger from migration 247 flips its line items to voided, which drops them
 * out of the partial unique index.
 */
export async function voidInvoice(
  invoiceId: string,
  reason: string,
): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const trimmed = reason.trim()
    if (!trimmed) return { ok: false, error: "Give a reason for voiding this invoice." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("rink_invoices")
      .update({
        status: "void",
        voided_at: new Date().toISOString(),
        voided_by: ctx.employeeId,
        void_reason: trimmed,
      })
      .eq("id", invoiceId)
      .eq("facility_id", ctx.facilityId)
    if (error) {
      return { ok: false, error: error.message || "Failed to void the invoice." }
    }

    revalidatePath(AR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordPayment(input: {
  invoiceId: string
  amount: number
  paymentMethodId: string | null
  paymentDate: string
  referenceNumber: string | null
  notes: string | null
}): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: invoice } = await supabase
      .from("rink_invoices")
      .select("status, total, amount_paid")
      .eq("id", input.invoiceId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!invoice) return { ok: false, error: "Invoice not found." }
    if (invoice.status === "void") {
      return { ok: false, error: "This invoice is void. Payments cannot be recorded against it." }
    }
    if (invoice.status === "draft") {
      return { ok: false, error: "Send the invoice before recording a payment against it." }
    }

    const check = checkPayment(
      input.amount,
      toCents(invoice.total),
      toCents(invoice.amount_paid),
    )
    if (!check.ok) return { ok: false, error: check.error }

    const { error } = await supabase.from("rink_payments").insert({
      facility_id: ctx.facilityId,
      invoice_id: input.invoiceId,
      amount: input.amount,
      payment_method_id: input.paymentMethodId,
      payment_date: input.paymentDate,
      reference_number: input.referenceNumber,
      notes: input.notes,
      recorded_by: ctx.employeeId,
    })
    if (error) {
      return { ok: false, error: error.message || "Failed to record the payment." }
    }

    await recomputePaid(input.invoiceId, ctx.facilityId)
    revalidatePath(AR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

/**
 * Reverse a payment by inserting a negative row referencing the original.
 *
 * Payments are append-only at two layers (no UPDATE/DELETE policy plus a guard
 * trigger), so this is the only way to undo one, and the audit trail keeps
 * both halves.
 */
export async function reversePayment(
  paymentId: string,
  reason: string,
): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const trimmed = reason.trim()
    if (!trimmed) return { ok: false, error: "Give a reason for the reversal." }

    const supabase = await createClient()
    const { data: original } = await supabase
      .from("rink_payments")
      .select("id, invoice_id, amount, payment_method_id")
      .eq("id", paymentId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!original) return { ok: false, error: "Payment not found." }
    if (Number(original.amount) < 0) {
      return { ok: false, error: "That row is itself a reversal." }
    }

    const { error } = await supabase.from("rink_payments").insert({
      facility_id: ctx.facilityId,
      invoice_id: original.invoice_id,
      amount: -Number(original.amount),
      payment_method_id: original.payment_method_id,
      // The reversal is dated in the FACILITY'S calendar: the UTC date is
      // already tomorrow every evening west of Greenwich.
      payment_date: dayKeyInTz(new Date(), await getFacilityTimezone(supabase, ctx.facilityId)),
      reverses_payment_id: original.id,
      notes: trimmed,
      recorded_by: ctx.employeeId,
    })
    if (error) {
      // The unique constraint on reverses_payment_id stops a double credit.
      if (error.code === "23505") {
        return { ok: false, error: "That payment has already been reversed." }
      }
      return { ok: false, error: error.message || "Failed to reverse the payment." }
    }

    await recomputePaid(original.invoice_id, ctx.facilityId)
    revalidatePath(AR_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

/**
 * Recompute amount_paid from the payment rows and re-derive the status.
 *
 * Server-side recomputation rather than a trigger — migration 247 required
 * picking one and being consistent. Doing it here keeps the sum and the status
 * transition in a single place, so they cannot disagree.
 */
async function recomputePaid(invoiceId: string, facilityId: string): Promise<void> {
  const supabase = await createClient()
  const [{ data: invoice }, { data: payments }] = await Promise.all([
    supabase
      .from("rink_invoices")
      .select("status, total")
      .eq("id", invoiceId)
      .eq("facility_id", facilityId)
      .maybeSingle(),
    supabase
      .from("rink_payments")
      .select("amount")
      .eq("invoice_id", invoiceId)
      .eq("facility_id", facilityId),
  ])
  if (!invoice) return

  // Reversals are negative, so a plain sum is the correct balance.
  const paidCents = (payments ?? []).reduce((sum, p) => sum + toCents(p.amount), 0)
  const status = deriveStatus(
    invoice.status as InvoiceStatus,
    toCents(invoice.total),
    paidCents,
  )

  await supabase
    .from("rink_invoices")
    .update({ amount_paid: centsToAmount(paidCents), status })
    .eq("id", invoiceId)
    .eq("facility_id", facilityId)
}
