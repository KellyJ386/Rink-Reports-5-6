// Client-side generator for the offline queue `local_id`.
//
// `offline_sync_queue.local_id` is a Postgres `uuid` column, so the value MUST
// be a spec-compliant UUID or the claim upsert fails the `uuid` cast (22P02) →
// 500 → the item burns its transient retries and parks as failed (E-05). The
// primary path is `crypto.randomUUID()`; the fallback (non-secure/legacy
// contexts where it is unavailable) produces a valid RFC 4122 v4 UUID rather
// than a `local-…`/`comm-…`/`ice-ops-…` string that would violate the column.

/** Generate a valid v4 UUID for use as an offline queue `local_id`. */
export function genLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return uuidV4Fallback()
}

/** RFC 4122 version-4 UUID built from the best entropy source available. */
function uuidV4Fallback(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // Set the version (4) and variant (10xx) bits per the UUID spec.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex: string[] = []
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1))
  return (
    hex[bytes[0]] +
    hex[bytes[1]] +
    hex[bytes[2]] +
    hex[bytes[3]] +
    "-" +
    hex[bytes[4]] +
    hex[bytes[5]] +
    "-" +
    hex[bytes[6]] +
    hex[bytes[7]] +
    "-" +
    hex[bytes[8]] +
    hex[bytes[9]] +
    "-" +
    hex[bytes[10]] +
    hex[bytes[11]] +
    hex[bytes[12]] +
    hex[bytes[13]] +
    hex[bytes[14]] +
    hex[bytes[15]]
  )
}
