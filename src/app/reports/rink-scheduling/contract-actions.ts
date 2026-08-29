"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireUser } from "@/lib/auth"
import { getFacilityTimezone } from "@/lib/facility-timezone"
import { logServerError } from "@/lib/observability/log-server-error"
import { currentUserCan } from "@/lib/permissions/check"
import {
  generateInvoiceCore,
  listUninvoicedBookingsCore,
} from "@/lib/rink-scheduling/invoice-generation"
import {
  decideContractInvoice,
  monthWindow,
  shiftSeasonOneYear,
} from "@/lib/rink-scheduling/season-contracts"
import { createClient } from "@/lib/supabase/server"
import { dayKeyInTz } from "@/lib/timezone"

import type { SimpleResult } from "./_lib/types"

const CONTRACTS_PATH = "/reports/rink-scheduling/contracts"
const AR_PATH = "/reports/rink-scheduling/invoices"

// ---------------------------------------------------------------------------
// Guard. Contracts are money: edit tier throughout, same as invoicing.
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
    return { ok: false, error: "Season contracts need the Rink Scheduling edit permission." }
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
  logServerError("reports/rink-scheduling/contract-actions", e)
  return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
}

const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

type ContractInput = {
  customerId: string
  name: string
  seasonStart: string
  seasonEnd: string
  /** Negotiated hourly rate; null defers to the rate cards. */
  contractRate: number | null
  autoInvoice: boolean
  autoSend: boolean
  invoiceDayOfMonth: number
  notes: string | null
}

function validateContractInput(input: ContractInput): string | null {
  if (!input.name.trim()) return "Give the contract a name, e.g. “2026–27 Youth League”."
  if (input.name.trim().length > 160) return "Name must be 160 characters or fewer."
  if (!DAY_KEY.test(input.seasonStart) || !DAY_KEY.test(input.seasonEnd)) {
    return "Pick the season's start and end dates."
  }
  if (input.seasonEnd <= input.seasonStart) return "The season must end after it starts."
  if (input.contractRate !== null && !(input.contractRate >= 0)) {
    return "The contract rate cannot be negative."
  }
  if (
    !Number.isInteger(input.invoiceDayOfMonth) ||
    input.invoiceDayOfMonth < 1 ||
    input.invoiceDayOfMonth > 28
  ) {
    return "Invoice day must be between 1 and 28 so it exists in every month."
  }
  if (input.notes !== null && input.notes.length > 4000) {
    return "Notes must be 4000 characters or fewer."
  }
  return null
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function createContract(
  input: ContractInput,
): Promise<{ ok: true; contractId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const problem = validateContractInput(input)
    if (problem) return { ok: false, error: problem }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("rink_season_contracts")
      .insert({
        facility_id: ctx.facilityId,
        customer_id: input.customerId,
        name: input.name.trim(),
        season_start: input.seasonStart,
        season_end: input.seasonEnd,
        contract_rate: input.contractRate,
        auto_invoice: input.autoInvoice,
        auto_send: input.autoSend,
        invoice_day_of_month: input.invoiceDayOfMonth,
        notes: input.notes,
        created_by: ctx.employeeId,
      })
      .select("id")
      .maybeSingle()
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Failed to create the contract." }
    }

    revalidatePath(CONTRACTS_PATH)
    return { ok: true, contractId: data.id }
  } catch (e) {
    return caught(e)
  }
}

export async function updateContract(
  contractId: string,
  input: ContractInput,
): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const problem = validateContractInput(input)
    if (problem) return { ok: false, error: problem }

    const supabase = await createClient()
    const { data: existing } = await supabase
      .from("rink_season_contracts")
      .select("status, contract_rate")
      .eq("id", contractId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!existing) return { ok: false, error: "Contract not found." }
    if (existing.status === "cancelled" || existing.status === "completed") {
      return { ok: false, error: "A finished contract can no longer be edited." }
    }

    const { error } = await supabase
      .from("rink_season_contracts")
      .update({
        customer_id: input.customerId,
        name: input.name.trim(),
        season_start: input.seasonStart,
        season_end: input.seasonEnd,
        contract_rate: input.contractRate,
        auto_invoice: input.autoInvoice,
        auto_send: input.autoSend,
        invoice_day_of_month: input.invoiceDayOfMonth,
        notes: input.notes,
      })
      .eq("id", contractId)
      .eq("facility_id", ctx.facilityId)
    if (error) return { ok: false, error: error.message || "Failed to save the contract." }

    // A rate change restates the price of ice not yet delivered — future
    // bookings of bound series reprice; the past keeps whatever it was
    // quoted (and anything invoiced is a document already).
    const oldRate = existing.contract_rate === null ? null : Number(existing.contract_rate)
    if (oldRate !== input.contractRate && input.contractRate !== null) {
      await repriceFutureBoundBookings(ctx.facilityId, contractId, input.contractRate)
    }

    revalidatePath(CONTRACTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

export async function activateContract(contractId: string): Promise<SimpleResult> {
  return setContractStatus(contractId, "draft", "active")
}

export async function cancelContract(
  contractId: string,
  reason: string,
): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const trimmed = reason.trim()
    if (!trimmed) return { ok: false, error: "Give a reason for cancelling this contract." }

    const supabase = await createClient()
    const { data: rows, error } = await supabase
      .from("rink_season_contracts")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: trimmed })
      .eq("id", contractId)
      .eq("facility_id", ctx.facilityId)
      .in("status", ["draft", "active"])
      .select("id")
    if (error) return { ok: false, error: error.message || "Failed to cancel the contract." }
    if ((rows ?? []).length === 0) {
      return { ok: false, error: "Contract not found, or it is already finished." }
    }

    // Deliberately does NOT cancel the bound series or their bookings — the
    // ice may still be honored or re-sold, and series have their own tools.
    revalidatePath(CONTRACTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

async function setContractStatus(
  contractId: string,
  from: string,
  to: string,
): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: rows, error } = await supabase
      .from("rink_season_contracts")
      .update({ status: to })
      .eq("id", contractId)
      .eq("facility_id", ctx.facilityId)
      .eq("status", from)
      .select("id")
    if (error) return { ok: false, error: error.message || "Failed to update the contract." }
    if ((rows ?? []).length === 0) {
      return { ok: false, error: `Only a ${from} contract can become ${to}.` }
    }

    revalidatePath(CONTRACTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

// ---------------------------------------------------------------------------
// Series binding
// ---------------------------------------------------------------------------

export async function bindSeries(
  contractId: string,
  seriesId: string,
): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const [{ data: contract }, { data: series }] = await Promise.all([
      supabase
        .from("rink_season_contracts")
        .select("id, status, customer_id, contract_rate")
        .eq("id", contractId)
        .eq("facility_id", ctx.facilityId)
        .maybeSingle(),
      supabase
        .from("rink_booking_series")
        .select("id, customer_id, contract_id")
        .eq("id", seriesId)
        .eq("facility_id", ctx.facilityId)
        .maybeSingle(),
    ])
    if (!contract) return { ok: false, error: "Contract not found." }
    if (contract.status === "cancelled" || contract.status === "completed") {
      return { ok: false, error: "A finished contract cannot take on new series." }
    }
    if (!series) return { ok: false, error: "Series not found." }
    if (series.contract_id && series.contract_id !== contractId) {
      return { ok: false, error: "That series is already bound to another contract." }
    }
    // The invoice is written to the CONTRACT's customer, so the series must
    // belong to the same customer — billing one club for another's ice is a
    // dispute, not a feature.
    if (series.customer_id !== contract.customer_id) {
      return { ok: false, error: "The series and the contract must belong to the same customer." }
    }

    const { error } = await supabase
      .from("rink_booking_series")
      .update({ contract_id: contractId })
      .eq("id", seriesId)
      .eq("facility_id", ctx.facilityId)
    if (error) return { ok: false, error: error.message || "Failed to bind the series." }

    if (contract.contract_rate !== null) {
      await repriceFutureBoundBookings(
        ctx.facilityId,
        contractId,
        Number(contract.contract_rate),
        seriesId,
      )
    }

    revalidatePath(CONTRACTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

export async function unbindSeries(seriesId: string): Promise<SimpleResult> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: rows, error } = await supabase
      .from("rink_booking_series")
      .update({ contract_id: null })
      .eq("id", seriesId)
      .eq("facility_id", ctx.facilityId)
      .not("contract_id", "is", null)
      .select("id")
    if (error) return { ok: false, error: error.message || "Failed to unbind the series." }
    if ((rows ?? []).length === 0) {
      return { ok: false, error: "That series is not bound to a contract." }
    }

    // Future bookings keep their contract-rate snapshots; repricing back to
    // card rates is a deliberate staff act (edit the series), not a side
    // effect of unbinding.
    revalidatePath(CONTRACTS_PATH)
    return { ok: true }
  } catch (e) {
    return caught(e)
  }
}

/**
 * Reprice FUTURE, non-cancelled bookings of the contract's bound series to
 * the negotiated hourly rate. The past keeps its quotes: delivered ice was
 * sold at the price on the day, and invoiced ice is a document already.
 */
async function repriceFutureBoundBookings(
  facilityId: string,
  contractId: string,
  rate: number,
  onlySeriesId?: string,
): Promise<void> {
  const supabase = await createClient()

  let seriesQuery = supabase
    .from("rink_booking_series")
    .select("id")
    .eq("facility_id", facilityId)
    .eq("contract_id", contractId)
  if (onlySeriesId) seriesQuery = seriesQuery.eq("id", onlySeriesId)
  const { data: series } = await seriesQuery
  const seriesIds = (series ?? []).map((s) => s.id)
  if (seriesIds.length === 0) return

  const nowIso = new Date().toISOString()
  const { data: bookings } = await supabase
    .from("rink_bookings")
    .select("id, starts_at, ends_at")
    .eq("facility_id", facilityId)
    .in("series_id", seriesIds)
    .neq("status", "cancelled")
    .gt("starts_at", nowIso)

  for (const b of bookings ?? []) {
    const hours =
      (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 3_600_000
    await supabase
      .from("rink_bookings")
      .update({
        rate_snapshot_hourly: rate,
        rate_snapshot_prime: null,
        computed_amount: Math.round(hours * rate * 100) / 100,
      })
      .eq("id", b.id)
      .eq("facility_id", facilityId)
  }
}

// ---------------------------------------------------------------------------
// Renewal + on-demand invoicing
// ---------------------------------------------------------------------------

/**
 * Draft next season from this one: dates shifted a year, same customer, rate
 * and billing settings carried over, renewal_of chained. Series are NOT
 * cloned — next season's ice is scheduled with the series tools and bound to
 * the new contract when it's real.
 */
export async function renewContract(
  contractId: string,
  name: string,
): Promise<{ ok: true; contractId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: "Name the renewal, e.g. “2027–28 Youth League”." }

    const supabase = await createClient()
    const { data: source } = await supabase
      .from("rink_season_contracts")
      .select("*")
      .eq("id", contractId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!source) return { ok: false, error: "Contract not found." }

    const { data: existing } = await supabase
      .from("rink_season_contracts")
      .select("id")
      .eq("facility_id", ctx.facilityId)
      .eq("renewal_of", contractId)
      .maybeSingle()
    if (existing) return { ok: false, error: "This contract already has a renewal on file." }

    const { data, error } = await supabase
      .from("rink_season_contracts")
      .insert({
        facility_id: ctx.facilityId,
        customer_id: source.customer_id,
        name: trimmed,
        season_start: shiftSeasonOneYear(source.season_start),
        season_end: shiftSeasonOneYear(source.season_end),
        contract_rate: source.contract_rate,
        auto_invoice: source.auto_invoice,
        auto_send: source.auto_send,
        invoice_day_of_month: source.invoice_day_of_month,
        notes: source.notes,
        renewal_of: contractId,
        created_by: ctx.employeeId,
      })
      .select("id")
      .maybeSingle()
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Failed to create the renewal." }
    }

    revalidatePath(CONTRACTS_PATH)
    return { ok: true, contractId: data.id }
  } catch (e) {
    return caught(e)
  }
}

/**
 * Bill the next due month now instead of waiting for the cron — the same
 * decision, claim, and generation path, just triggered by a person.
 */
export async function generateContractInvoiceNow(
  contractId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireBiller()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const supabase = await createClient()
    const { data: contract } = await supabase
      .from("rink_season_contracts")
      .select("*")
      .eq("id", contractId)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!contract) return { ok: false, error: "Contract not found." }

    const timeZone = await getFacilityTimezone(supabase, ctx.facilityId)
    const todayKey = dayKeyInTz(new Date(), timeZone)

    const decision = decideContractInvoice(
      {
        status: contract.status,
        seasonStart: contract.season_start,
        seasonEnd: contract.season_end,
        // A person clicking the button IS the invoice-day condition.
        invoiceDayOfMonth: 1,
        lastInvoicedPeriod: contract.last_invoiced_period,
        autoInvoice: true,
      },
      todayKey,
    )
    if (!decision.due) {
      switch (decision.reason) {
        case "not_active":
          return { ok: false, error: "Only an active contract can be invoiced." }
        case "period_not_elapsed":
          return { ok: false, error: "The next billing month hasn't finished yet." }
        case "season_fully_invoiced":
          return { ok: false, error: "Every month of this season has been invoiced." }
        default:
          return { ok: false, error: "Nothing to invoice right now." }
      }
    }

    const { data: series } = await supabase
      .from("rink_booking_series")
      .select("id")
      .eq("facility_id", ctx.facilityId)
      .eq("contract_id", contractId)
    const seriesIds = new Set((series ?? []).map((s) => s.id))

    const window = monthWindow(decision.periodKey)
    const listed = await listUninvoicedBookingsCore(supabase, ctx.facilityId, {
      customerId: contract.customer_id,
      fromDayKey: window.fromKey,
      toDayKey: window.toKey,
    })
    if (!listed.ok) return { ok: false, error: listed.error }
    const covered = listed.bookings.filter(
      (b) => b.seriesId !== null && seriesIds.has(b.seriesId),
    )

    // Claim the period compare-and-set, same as the cron, so a button click
    // racing the daily run cannot double-bill a month.
    let claim = supabase
      .from("rink_season_contracts")
      .update({ last_invoiced_period: decision.periodKey })
      .eq("id", contractId)
      .eq("facility_id", ctx.facilityId)
    claim =
      contract.last_invoiced_period === null
        ? claim.is("last_invoiced_period", null)
        : claim.eq("last_invoiced_period", contract.last_invoiced_period)
    const { data: claimed } = await claim.select("id")
    if ((claimed ?? []).length === 0) {
      return { ok: false, error: "That month was just invoiced by the automatic run." }
    }

    if (covered.length === 0) {
      revalidatePath(CONTRACTS_PATH)
      return {
        ok: true,
        message: `No uninvoiced contract ice in ${decision.periodKey} — the month is marked billed with nothing owed.`,
      }
    }

    const generated = await generateInvoiceCore(supabase, ctx.facilityId, {
      customerId: contract.customer_id,
      bookings: covered,
      issueDate: todayKey,
      notes: `${contract.name} — ${decision.periodKey}`,
      employeeId: ctx.employeeId,
      contractId: contract.id,
    })
    if (!generated.ok) {
      // Put the claimed period back so the month stays billable — without
      // this, a transient failure here would read as "nothing to invoice"
      // forever. Guarded on the value we wrote.
      await supabase
        .from("rink_season_contracts")
        .update({ last_invoiced_period: contract.last_invoiced_period })
        .eq("id", contractId)
        .eq("facility_id", ctx.facilityId)
        .eq("last_invoiced_period", decision.periodKey)
      return generated
    }

    revalidatePath(CONTRACTS_PATH)
    revalidatePath(AR_PATH)
    return {
      ok: true,
      message: `Draft ${generated.number} created for ${decision.periodKey} (${covered.length} booking${covered.length === 1 ? "" : "s"}).`,
    }
  } catch (e) {
    return caught(e)
  }
}
