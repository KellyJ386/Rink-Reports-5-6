"use server"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"
import { isEmailConfigured, sendEmail } from "@/lib/notifications/transport/email"

import { buildAirQualityLogPdf } from "./_lib/log-pdf"

export type SendLogState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | { ok: null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Email the inspector-ready Air Quality monitoring-log PDF for a date range to
 * one or more recipients (e.g. a state inspector). Admin-gated; the PDF is
 * built through the caller's RLS-scoped client so it only ever contains the
 * admin's own facility's readings. Honors the environment email delivery gate.
 */
export async function sendAirQualityLog(
  _prev: SendLogState,
  formData: FormData,
): Promise<SendLogState> {
  try {
    const current = await requireAdmin()
    const facilityId = current.profile?.facility_id ?? null
    if (!facilityId) return { ok: false, error: "No facility assigned." }

    const fromRaw = String(formData.get("from") ?? "")
    const toRaw = String(formData.get("to") ?? "")
    if (!DATE_RE.test(fromRaw) || !DATE_RE.test(toRaw)) {
      return { ok: false, error: "Invalid date range." }
    }

    const recipients = String(formData.get("recipients") ?? "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (recipients.length === 0) {
      return { ok: false, error: "Enter at least one recipient email." }
    }
    const invalid = recipients.filter((e) => !EMAIL_RE.test(e))
    if (invalid.length > 0) {
      return { ok: false, error: `Invalid email: ${invalid[0]}` }
    }

    if (!isEmailConfigured()) {
      return {
        ok: false,
        error:
          "Email delivery is not enabled in this environment. Download the PDF and attach it manually.",
      }
    }

    const supabase = await createClient()
    const rendered = await buildAirQualityLogPdf(
      supabase,
      facilityId,
      fromRaw,
      toRaw,
    )
    if (!rendered) {
      return { ok: false, error: "Could not build the log PDF." }
    }

    const { data: facility } = await supabase
      .from("facilities")
      .select("name")
      .eq("id", facilityId)
      .maybeSingle()
    const facilityName = facility?.name ?? "Facility"

    // Best-effort log so the sender is recorded even before transport returns.
    const me = await getCurrentUser()
    const subject = `Air Quality Monitoring Log — ${facilityName} — ${fromRaw} to ${toRaw}`
    const bodyText = [
      `Air Quality monitoring log for ${facilityName}.`,
      `Date range: ${fromRaw} to ${toRaw}.`,
      `Sent by ${me?.authUser?.email ?? "an administrator"} via Rink Reports.`,
      "The inspector-ready log is attached as a PDF.",
    ].join("\n")

    let sent = 0
    const failures: string[] = []
    for (const to of recipients) {
      const result = await sendEmail({
        to,
        subject,
        bodyText,
        attachments: [
          {
            filename: rendered.filename,
            content: rendered.buffer,
            contentType: "application/pdf",
          },
        ],
      })
      if (result.ok) sent += 1
      else failures.push(`${to}: ${result.error}`)
    }

    if (sent === 0) {
      return {
        ok: false,
        error: `Failed to send. ${failures[0] ?? ""}`.trim(),
      }
    }
    const suffix = failures.length > 0 ? ` (${failures.length} failed)` : ""
    return {
      ok: true,
      message: `Sent the log to ${sent} recipient${sent === 1 ? "" : "s"}${suffix}.`,
    }
  } catch (e) {
    logServerError("admin/air-quality/log/actions", e)
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
