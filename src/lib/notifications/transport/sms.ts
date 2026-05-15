import "server-only"

import twilio, { type Twilio } from "twilio"

export type SmsSendInput = {
  to: string
  body: string
}

export type SmsSendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string }

/**
 * Returns a configured Twilio client, or null if any of the required env
 * vars (account SID, auth token, from number) are missing. Caller treats
 * null as "skip SMS channel" — the recipient row stays in 'pending'.
 */
function getTwilio(): Twilio | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return twilio(sid, token)
}

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM,
  )
}

export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  const client = getTwilio()
  const from = process.env.TWILIO_FROM
  if (!client || !from) {
    return { ok: false, error: "Twilio not configured" }
  }

  try {
    const msg = await client.messages.create({
      from,
      to: input.to,
      body: input.body,
    })
    return { ok: true, providerId: msg.sid ?? null }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown Twilio error",
    }
  }
}
