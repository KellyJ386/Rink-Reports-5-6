import "server-only"

import { Resend } from "resend"

export type EmailAttachment = {
  filename: string
  content: Buffer
  contentType?: string
}

export type EmailSendInput = {
  to: string
  subject: string
  bodyText: string
  bodyHtml?: string
  attachments?: EmailAttachment[]
}

export type EmailSendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string }

/**
 * Returns a configured Resend client, or null if RESEND_API_KEY is unset.
 * Caller is expected to treat null as "skip email channel for this run"
 * — the recipient row stays in 'pending' so it retries once secrets land.
 */
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM)
}

export async function sendEmail(
  input: EmailSendInput,
): Promise<EmailSendResult> {
  const client = getResend()
  const from = process.env.RESEND_FROM
  if (!client || !from) {
    return { ok: false, error: "Resend not configured" }
  }

  try {
    const result = await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.bodyText,
      ...(input.bodyHtml ? { html: input.bodyHtml } : {}),
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
    })
    if (result.error) {
      return { ok: false, error: result.error.message ?? "Resend error" }
    }
    return { ok: true, providerId: result.data?.id ?? null }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown Resend error",
    }
  }
}
