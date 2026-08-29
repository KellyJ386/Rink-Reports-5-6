import { withCronRoute } from "@/lib/cron/with-cron-auth"
import { runContractInvoices } from "@/lib/rink-scheduling/contract-invoices"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Daily season-contract invoicing for Rink Scheduling & Billing.
 *
 * For every active contract with auto-invoicing on, generates the invoice for
 * the previous calendar month's bound-series ice — on/after the contract's
 * invoice day, at most once per month (last_invoiced_period is the
 * compare-and-set cursor), through the SAME generation path a biller's
 * "Generate invoice" uses. auto_send contracts are issued and emailed;
 * everything else lands as a draft for review. Finished seasons retire
 * themselves to `completed` once their final month is billed.
 *
 * Auth, the service-role client, timing and the cron_runs record are handled
 * by withCronRoute.
 */
export const GET = withCronRoute("/api/cron/rink-contract-invoices", async (supabase) => {
  const result = await runContractInvoices(supabase)

  const summary = {
    contracts_considered: result.contractsConsidered,
    invoices_created: result.invoicesCreated,
    invoices_sent: result.invoicesSent,
    empty_periods: result.emptyPeriods,
    completed: result.completed,
    failures: result.failures,
  }

  return {
    status: result.failures > 0 ? 500 : 200,
    body: { ok: result.failures === 0, ...summary },
    summary,
    ...(result.failures > 0 ? { error: `${result.failures} contract(s) failed` } : {}),
  }
})
