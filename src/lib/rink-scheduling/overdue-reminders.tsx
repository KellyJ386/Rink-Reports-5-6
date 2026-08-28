// The overdue-invoice reminder sweep.
//
// Runs with a SERVICE-ROLE client (from the cron wrapper), which bypasses RLS
// — required, because it acts for every facility with no user session — so
// every query below carries an explicit facility_id predicate rather than
// relying on a policy to scope it.
//
// WHO gets reminded and HOW OFTEN is pure logic in overdue.ts (unit-tested);
// this file only applies those decisions: render the invoice PDF, send the
// email as the facility, and record last_reminder_at so a daily schedule
// cannot nag daily.

import type { SupabaseClient } from "@supabase/supabase-js"
import { renderToBuffer } from "@react-pdf/renderer"

import { logServerError } from "@/lib/observability/log-server-error"
import { sendEmail, isEmailConfigured } from "@/lib/notifications/transport/email"
import { formatMoney, toCents } from "@/lib/rink-scheduling/ar"
import { buildOverdueReminderEmail } from "@/lib/rink-scheduling/invoice-email"
import { InvoicePdf } from "@/lib/rink-scheduling/invoice-pdf"
import { loadInvoicePdfData } from "@/lib/rink-scheduling/invoice-pdf-data"
import { agingBucket, decideReminder } from "@/lib/rink-scheduling/overdue"
import { dayKeyInTz } from "@/lib/timezone"
import type { Database, Tables } from "@/types/database"

type Client = SupabaseClient<Database>

/** Ceiling on emails per run. A backlog (a facility that just enabled
 *  reminders with a year of unpaid invoices) drains over successive daily
 *  runs instead of blowing the route's time budget in one. */
const MAX_SENDS_PER_RUN = 25

export type ReminderSweepResult = {
  facilities: number
  considered: number
  sent: number
  skippedNoEmail: number
  failures: number
  /** Aging-bucket tally of what was sent, for the cron_runs record. */
  buckets: Record<string, number>
  /** Set when the whole run was short-circuited (e.g. email not configured). */
  skipped?: string
}

export async function runOverdueReminders(supabase: Client): Promise<ReminderSweepResult> {
  const result: ReminderSweepResult = {
    facilities: 0,
    considered: 0,
    sent: 0,
    skippedNoEmail: 0,
    failures: 0,
    buckets: {},
  }

  if (!isEmailConfigured()) {
    result.skipped = "email transport not configured"
    return result
  }

  const { data: settingsRows, error: settingsError } = await supabase
    .from("rink_scheduling_settings")
    .select("facility_id, overdue_reminders_enabled, reminder_cadence_days")
    .eq("overdue_reminders_enabled", true)
  if (settingsError) throw settingsError

  const enabled = settingsRows ?? []
  if (enabled.length === 0) return result

  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name, email, phone, timezone")
    .in("id", enabled.map((s) => s.facility_id))
  const facilityById = new Map((facilities ?? []).map((f) => [f.id, f]))

  const now = new Date()
  const nowMs = now.getTime()

  for (const settings of enabled) {
    const facility = facilityById.get(settings.facility_id)
    if (!facility) continue
    result.facilities += 1

    const timeZone = facility.timezone ?? null
    const todayKey = dayKeyInTz(now, timeZone)
    const cadenceDays = settings.reminder_cadence_days ?? 7

    // Open, past-due invoices only; the cadence filter needs last_reminder_at
    // so it runs in decideReminder rather than SQL.
    const { data: invoices, error: invoicesError } = await supabase
      .from("rink_invoices")
      .select("*")
      .eq("facility_id", settings.facility_id)
      .in("status", ["sent", "partially_paid"])
      .lt("due_date", todayKey)
      .order("due_date", { ascending: true })
    if (invoicesError) {
      logServerError("rink-scheduling/overdue-reminders", invoicesError)
      result.failures += 1
      continue
    }

    const open = (invoices ?? []) as Tables<"rink_invoices">[]
    if (open.length === 0) continue

    const { data: customers } = await supabase
      .from("rink_customers")
      .select("id, name, contact_name, contact_email")
      .eq("facility_id", settings.facility_id)
      .in("id", [...new Set(open.map((i) => i.customer_id))])
    const customerById = new Map((customers ?? []).map((c) => [c.id, c]))

    for (const invoice of open) {
      if (result.sent >= MAX_SENDS_PER_RUN) return result
      result.considered += 1

      const decision = decideReminder(
        {
          status: invoice.status,
          dueDate: invoice.due_date,
          lastReminderAt: invoice.last_reminder_at,
        },
        { todayKey, nowMs, cadenceDays },
      )
      if (!decision.due) continue

      const customer = customerById.get(invoice.customer_id)
      const to = (customer?.contact_email ?? "").trim()
      if (!to) {
        result.skippedNoEmail += 1
        continue
      }

      try {
        const { data: pdfData } = await loadInvoicePdfData(supabase, invoice)
        const buffer = await renderToBuffer(<InvoicePdf data={pdfData} />)

        const amountDueCents = toCents(invoice.total) - toCents(invoice.amount_paid)
        const message = buildOverdueReminderEmail({
          facilityName: facility.name,
          facilityEmail: facility.email ?? null,
          facilityPhone: facility.phone ?? null,
          invoiceNumber: invoice.invoice_number,
          customerName: customer?.name ?? "Customer",
          contactName: customer?.contact_name ?? null,
          amountDue: formatMoney(amountDueCents / 100),
          dueDate: invoice.due_date,
          paymentTerms: pdfData.paymentTerms,
          daysOverdue: decision.daysOverdue,
        })

        const sentResult = await sendEmail({
          to,
          subject: message.subject,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          attachments: [
            {
              filename: `${invoice.invoice_number}.pdf`,
              content: buffer,
              contentType: "application/pdf",
            },
          ],
        })
        if (!sentResult.ok) {
          logServerError("rink-scheduling/overdue-reminders", new Error(sentResult.error))
          result.failures += 1
          continue
        }

        // Recorded AFTER a successful send: a failed send should retry on the
        // next run, and a duplicate (send ok, write lost) is the safer error.
        await supabase
          .from("rink_invoices")
          .update({
            last_reminder_at: now.toISOString(),
            reminder_count: (invoice.reminder_count ?? 0) + 1,
          })
          .eq("id", invoice.id)
          .eq("facility_id", settings.facility_id)

        result.sent += 1
        const bucket = agingBucket(decision.daysOverdue)
        result.buckets[bucket] = (result.buckets[bucket] ?? 0) + 1
      } catch (e) {
        logServerError("rink-scheduling/overdue-reminders", e)
        result.failures += 1
      }
    }
  }

  return result
}
