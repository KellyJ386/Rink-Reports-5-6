// Pure validation for the public booking-request form.
//
// Dependency-free (vitest, plain Node). This is the module's only surface
// that accepts input from the open internet, so the rules live in one tested
// place and both the API route and the form share them. Limits mirror the
// table's CHECK constraints exactly — the database is the backstop, this is
// the sentence the requester actually reads.

export type BookingRequestInput = {
  requesterName: string
  requesterEmail: string
  requesterPhone: string | null
  organization: string | null
  rinkId: string | null
  /** YYYY-MM-DD, facility-local. */
  requestedDate: string
  /** Minutes past local midnight; end may run to 1680 (next-day 04:00). */
  startMinute: number
  endMinute: number
  purpose: string | null
}

export type BookingRequestValidation =
  | { ok: true; value: BookingRequestInput }
  | { ok: false; error: string }

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function optionalTrimmed(value: unknown, max: number, label: string):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > max) {
    return { ok: false, error: `${label} must be ${max} characters or fewer.` }
  }
  return { ok: true, value: trimmed }
}

/**
 * Validate raw (untrusted) form input into a well-formed request, or a single
 * human sentence about the first problem.
 *
 * `todayKey` is the facility-local today: requests for the past are refused
 * here rather than becoming inbox noise, and the horizon stops obviously
 * unserious dates ("in 3 years") without pretending to police intent.
 */
export function validateBookingRequest(
  raw: Record<string, unknown>,
  todayKey: string,
): BookingRequestValidation {
  const name = typeof raw.requesterName === "string" ? raw.requesterName.trim() : ""
  if (!name) return { ok: false, error: "Enter your name." }
  if (name.length > 120) return { ok: false, error: "Name must be 120 characters or fewer." }

  const email = typeof raw.requesterEmail === "string" ? raw.requesterEmail.trim() : ""
  if (!email || !EMAIL_SHAPE.test(email) || email.length > 254) {
    return { ok: false, error: "Enter a valid email address." }
  }

  const phone = optionalTrimmed(raw.requesterPhone, 40, "Phone")
  if (!phone.ok) return phone
  const organization = optionalTrimmed(raw.organization, 160, "Organization")
  if (!organization.ok) return organization
  const purpose = optionalTrimmed(raw.purpose, 2000, "Message")
  if (!purpose.ok) return purpose

  let rinkId: string | null = null
  if (raw.rinkId !== null && raw.rinkId !== undefined && raw.rinkId !== "") {
    if (typeof raw.rinkId !== "string" || !UUID_SHAPE.test(raw.rinkId)) {
      return { ok: false, error: "Pick a rink from the list." }
    }
    rinkId = raw.rinkId
  }

  const date = typeof raw.requestedDate === "string" ? raw.requestedDate : ""
  if (!DAY_KEY.test(date)) return { ok: false, error: "Pick a date." }
  if (date < todayKey) return { ok: false, error: "Pick a date that has not already passed." }
  const horizon = `${Number(todayKey.slice(0, 4)) + 2}${todayKey.slice(4)}`
  if (date > horizon) {
    return { ok: false, error: "Pick a date within the next two years." }
  }

  const start = raw.startMinute
  const end = raw.endMinute
  if (
    typeof start !== "number" || !Number.isInteger(start) || start < 0 || start >= 1440 ||
    typeof end !== "number" || !Number.isInteger(end) || end <= start || end > 1680
  ) {
    return { ok: false, error: "Choose a start and end time (end after start)." }
  }
  if (end - start < 30) {
    return { ok: false, error: "Requests must be for at least 30 minutes of ice." }
  }

  return {
    ok: true,
    value: {
      requesterName: name,
      requesterEmail: email,
      requesterPhone: phone.value,
      organization: organization.value,
      rinkId,
      requestedDate: date,
      startMinute: start,
      endMinute: end,
      purpose: purpose.value,
    },
  }
}

/** "17:30" -> 1050. Null for anything that is not a valid HH:MM. */
export function hhmmToMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** 1050 -> "5:30 PM" (facility wall clock; pure arithmetic, no zone). */
export function minuteToLabel(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440
  const h24 = Math.floor(normalized / 60)
  const m = normalized % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`
}
