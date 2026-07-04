// Wall-clock timestamp rendering.
//
// Some report timestamps (e.g. incident_reports.occurred_at) store the
// wall-clock the reporter typed into a datetime-local input, serialized
// as-if-UTC: the submit path runs `new Date(localString).toISOString()` on a
// UTC server, so the string the reporter entered lives in the value's UTC
// components. Formatting such a value with a real timezone (the viewer's or
// the facility's) shifts it and shows a time nobody entered — always read the
// UTC components back instead.
//
// Real instants (submitted_at, reviewed_at, …) should NOT use this; format
// those with the facility timezone or the viewer's locale as usual.

/** Format a wall-clock-as-UTC timestamp (e.g. "Jul 4, 2026, 10:30 AM"). */
export function formatWallClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  })
}
