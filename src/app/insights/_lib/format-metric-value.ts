// Pure formatting for a single metric value, whatever shape it comes in
// (number, string breakdown object, label array, or null). No server-only
// imports — unit-tested directly.

export type FormattedMetric =
  | { kind: "empty" }
  | { kind: "scalar"; text: string }
  | { kind: "breakdown"; entries: Array<{ key: string; text: string }> }
  | { kind: "list"; items: string[] }

function formatNumber(value: number): string {
  // Integers render bare; anything with a fractional part keeps up to 2
  // decimals (mean_depth, completion_pct, median_hours_to_resolve).
  if (Number.isInteger(value)) return value.toLocaleString("en-US")
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

export function formatMetricValue(value: unknown, unit: string | null): FormattedMetric {
  if (value === null || value === undefined) return { kind: "empty" }

  if (typeof value === "number") {
    const text = unit ? `${formatNumber(value)} ${unit}` : formatNumber(value)
    return { kind: "scalar", text }
  }

  if (typeof value === "boolean") {
    return { kind: "scalar", text: value ? "Yes" : "No" }
  }

  if (typeof value === "string") {
    return { kind: "scalar", text: value }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "empty" }
    return { kind: "list", items: value.map((v) => String(v)) }
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return { kind: "empty" }
    return {
      kind: "breakdown",
      entries: entries.map(([key, v]) => ({
        key,
        text: typeof v === "number" ? formatNumber(v) : String(v),
      })),
    }
  }

  return { kind: "scalar", text: String(value) }
}
