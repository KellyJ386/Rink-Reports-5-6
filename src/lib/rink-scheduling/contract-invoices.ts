// The season-contract invoicing sweep.
//
// Runs with a SERVICE-ROLE client (from the cron wrapper), which bypasses RLS
// — required, because it bills for every facility with no user session — so
// every query below carries an explicit facility_id predicate.
//
// WHEN a contract bills and for WHICH month is pure logic in
// season-contracts.ts (unit-tested); WHAT an invoice contains comes from
// invoice-generation.ts, the same code path a biller's "Generate invoice"
// uses — the cron produces byte-identical documents, just on schedule.

import type { SupabaseClient } from "@supabase/supabase-js"

import { logServerError } from "@/lib/observability/log-server-error"
import { deriveStatus, toCents } from "@/lib/rink-scheduling/ar"
import { deliverInvoiceEmail } from "@/lib/rink-scheduling/deliver-invoice-email"
import {
  generateInvoiceCore,
  listUninvoicedBookingsCore,
} from "@/lib/rink-scheduling/invoice-generation"
import {
  decideContractInvoice,
  monthWindow,
  shouldComplete,
} from "@/lib/rink-scheduling/season-contracts"
import { dayKeyInTz } from "@/lib/timezone"
import type { Database, Tables } from "@/types/database"

type Client = SupabaseClient<Database>

/** Ceiling on invoices per run: a facility that activates several backdated
 *  contracts drains over successive daily runs instead of blowing the time
 *  budget (auto_send renders a PDF per invoice). */
const MAX_INVOICES_PER_RUN = 15

export type ContractSweepResult = {
  contractsConsidered: number
  invoicesCreated: number
  invoicesSent: number
  emptyPeriods: number
  completed: number
  failures: number
}

export async function runContractInvoices(supabase: Client): Promise<ContractSweepResult> {
  const result: ContractSweepResult = {
    contractsConsidered: 0,
    invoicesCreated: 0,
    invoicesSent: 0,
    emptyPeriods: 0,
    completed: 0,
    failures: 0,
  }

  const { data: contracts, error: contractsError } = await supabase
    .from("rink_season_contracts")
    .select("*")
    .eq("status", "active")
  if (contractsError) throw contractsError
  const active = (contracts ?? []) as Tables<"rink_season_contracts">[]
  if (active.length === 0) return result

  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, timezone")
    .in("id", [...new Set(active.map((c) => c.facility_id))])
  const zoneByFacility = new Map((facilities ?? []).map((f) => [f.id, f.timezone ?? null]))

  const now = new Date()

  for (const contract of active) {
    if (result.invoicesCreated >= MAX_INVOICES_PER_RUN) break
    result.contractsConsidered += 1
    const todayKey = dayKeyInTz(now, zoneByFacility.get(contract.facility_id) ?? null)

    try {
      const like = {
        status: contract.status,
        seasonStart: contract.season_start,
        seasonEnd: contract.season_end,
        invoiceDayOfMonth: contract.invoice_day_of_month,
        lastInvoicedPeriod: contract.last_invoiced_period,
        autoInvoice: contract.auto_invoice,
      }

      const decision = decideContractInvoice(like, todayKey)
      if (!decision.due) {
        // A finished season retires itself once its last month is billed.
        if (shouldComplete(like, todayKey)) {
          await supabase
            .from("rink_season_contracts")
            .update({ status: "completed" })
            .eq("id", contract.id)
            .eq("facility_id", contract.facility_id)
            .eq("status", "active")
          result.completed += 1
        }
        continue
      }

      // Which of this month's bookings does the contract cover? Exactly the
      // ones expanded from its bound series — a one-off extra rental the same
      // customer made stays out of the contract invoice for a biller to bill
      // deliberately.
      const { data: series } = await supabase
        .from("rink_booking_series")
        .select("id")
        .eq("facility_id", contract.facility_id)
        .eq("contract_id", contract.id)
      const seriesIds = new Set((series ?? []).map((s) => s.id))

      const window = monthWindow(decision.periodKey)
      const listed = await listUninvoicedBookingsCore(supabase, contract.facility_id, {
        customerId: contract.customer_id,
        fromDayKey: window.fromKey,
        toDayKey: window.toKey,
      })
      if (!listed.ok) {
        result.failures += 1
        continue
      }

      const covered = listed.bookings.filter(
        (b) => b.seriesId !== null && seriesIds.has(b.seriesId),
      )

      // CLAIM THE PERIOD FIRST, and advance the cursor even when the month
      // turns out empty: a month with no ice (holiday shutdown, series
      // paused) is a billed-nothing month, not a month to retry forever.
      // The update is guarded on the cursor's previous value — compare-and-
      // set, same idiom as invoice numbering — so two overlapping runs
      // cannot both bill the same period.
      let claim = supabase
        .from("rink_season_contracts")
        .update({ last_invoiced_period: decision.periodKey })
        .eq("id", contract.id)
        .eq("facility_id", contract.facility_id)
      claim =
        contract.last_invoiced_period === null
          ? claim.is("last_invoiced_period", null)
          : claim.eq("last_invoiced_period", contract.last_invoiced_period)
      const { data: claimed } = await claim.select("id")
      if ((claimed ?? []).length === 0) {
        continue // a concurrent run claimed this period first
      }

      if (covered.length === 0) {
        result.emptyPeriods += 1
        continue
      }

      const generated = await generateInvoiceCore(supabase, contract.facility_id, {
        customerId: contract.customer_id,
        bookings: covered,
        issueDate: todayKey,
        notes: `${contract.name} — ${decision.periodKey}`,
        employeeId: null,
        contractId: contract.id,
      })
      if (!generated.ok) {
        logServerError("rink-scheduling/contract-invoices", new Error(generated.error))
        result.failures += 1
        continue
      }
      result.invoicesCreated += 1

      if (contract.auto_send) {
        const { data: invoice } = await supabase
          .from("rink_invoices")
          .select("*")
          .eq("id", generated.invoiceId)
          .eq("facility_id", contract.facility_id)
          .maybeSingle()
        if (invoice) {
          // Same derivation as the biller's Send button: a $0 month settles
          // itself instead of stranding at "sent".
          const status = deriveStatus("sent", toCents(invoice.total), toCents(invoice.amount_paid))
          await supabase
            .from("rink_invoices")
            .update({ status, sent_at: now.toISOString() })
            .eq("id", invoice.id)
            .eq("facility_id", contract.facility_id)
          const outcome = await deliverInvoiceEmail(supabase, { ...invoice, status })
          if (outcome.delivered) result.invoicesSent += 1
        }
      }
    } catch (e) {
      logServerError("rink-scheduling/contract-invoices", e)
      result.failures += 1
    }
  }

  return result
}
