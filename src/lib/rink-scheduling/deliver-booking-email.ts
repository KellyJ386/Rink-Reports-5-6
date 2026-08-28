import "server-only"

import { logServerError } from "@/lib/observability/log-server-error"
import { sendEmail, isEmailConfigured } from "@/lib/notifications/transport/email"
import { formatMoney } from "@/lib/rink-scheduling/ar"
import { buildBookingConfirmationEmail } from "@/lib/rink-scheduling/booking-email"
import type { createClient } from "@/lib/supabase/server"
import { dayKeyInTz, formatInTz } from "@/lib/timezone"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Best-effort by contract: a booking exists because the scheduler saved it,
 * never because an email left the building. Every outcome is data; the caller
 * only logs the interesting ones.
 */
export type BookingEmailOutcome =
  | { delivered: true; to: string }
  | { delivered: false; reason: "disabled" | "no_customer" | "no_email" | "not_configured" }
  | { delivered: false; reason: "failed"; to: string; detail: string }

/**
 * Email the customer's billing contact a confirmation of a just-created
 * booking. Gated on the facility's `send_booking_confirmations` setting
 * (OFF by default — customer-facing email is an explicit opt-in), and reads
 * through the caller's RLS-scoped client so it can only describe a booking
 * the caller could already open.
 */
export async function deliverBookingConfirmation(
  supabase: ServerSupabase,
  facilityId: string,
  bookingId: string,
): Promise<BookingEmailOutcome> {
  try {
    const { data: settings } = await supabase
      .from("rink_scheduling_settings")
      .select("send_booking_confirmations")
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!settings?.send_booking_confirmations) {
      return { delivered: false, reason: "disabled" }
    }

    const { data: booking } = await supabase
      .from("rink_bookings")
      .select(
        "id, title, starts_at, ends_at, status, computed_amount, customer_id, booking_type_id, rink_id",
      )
      .eq("id", bookingId)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!booking) return { delivered: false, reason: "no_customer" }
    if (!booking.customer_id) return { delivered: false, reason: "no_customer" }

    const [{ data: customer }, { data: rink }, { data: type }, { data: facility }] =
      await Promise.all([
        supabase
          .from("rink_customers")
          .select("name, contact_name, contact_email")
          .eq("id", booking.customer_id)
          .eq("facility_id", facilityId)
          .maybeSingle(),
        supabase
          .from("facility_rinks")
          .select("name")
          .eq("id", booking.rink_id)
          .eq("facility_id", facilityId)
          .maybeSingle(),
        supabase
          .from("rink_booking_types")
          .select("name")
          .eq("id", booking.booking_type_id)
          .eq("facility_id", facilityId)
          .maybeSingle(),
        supabase
          .from("facilities")
          .select("name, email, phone, timezone")
          .eq("id", facilityId)
          .maybeSingle(),
      ])

    const to = (customer?.contact_email ?? "").trim()
    if (!to) return { delivered: false, reason: "no_email" }
    if (!isEmailConfigured()) return { delivered: false, reason: "not_configured" }

    const timeZone = facility?.timezone ?? null
    const timeOpts = { hour: "numeric", minute: "2-digit" } as const
    const message = buildBookingConfirmationEmail({
      facilityName: facility?.name ?? "Your rink",
      facilityEmail: facility?.email ?? null,
      facilityPhone: facility?.phone ?? null,
      customerName: customer?.name ?? "Customer",
      contactName: customer?.contact_name ?? null,
      title: booking.title,
      typeName: type?.name ?? "Ice time",
      rinkName: rink?.name ?? "Rink",
      dayKey: dayKeyInTz(booking.starts_at, timeZone),
      timeRange: `${formatInTz(booking.starts_at, timeZone, timeOpts)} – ${formatInTz(booking.ends_at, timeZone, timeOpts)}`,
      status: booking.status === "confirmed" ? "confirmed" : "tentative",
      amount:
        booking.computed_amount === null ? null : formatMoney(booking.computed_amount),
    })

    const sent = await sendEmail({
      to,
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
    })
    if (!sent.ok) return { delivered: false, reason: "failed", to, detail: sent.error }
    return { delivered: true, to }
  } catch (e) {
    logServerError("rink-scheduling/deliver-booking-email", e)
    return {
      delivered: false,
      reason: "failed",
      to: "",
      detail: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
