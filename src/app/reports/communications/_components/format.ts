import type { AlertSeverity, AlertSourceModule } from "../types"

export function formatTimestamp(iso: string, timezone: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

export function relativeAge(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const now = Date.now()
  const diffSec = Math.max(0, Math.round((now - then) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  const diffWk = Math.round(diffDay / 7)
  if (diffWk < 5) return `${diffWk}w ago`
  const diffMo = Math.round(diffDay / 30)
  if (diffMo < 12) return `${diffMo}mo ago`
  const diffYr = Math.round(diffDay / 365)
  return `${diffYr}y ago`
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: "Info",
  warn: "Warning",
  high: "High",
  critical: "Critical",
}

export function severityLabel(value: string): string {
  if (value === "info" || value === "warn" || value === "high" || value === "critical") {
    return SEVERITY_LABEL[value]
  }
  return value
}

export function severityClasses(value: string): string {
  switch (value) {
    case "critical":
      return "bg-red-600 text-white"
    case "high":
      return "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100"
    case "warn":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
    case "info":
    default:
      return "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
  }
}

const SOURCE_MODULE_LABEL: Record<AlertSourceModule, string> = {
  ice_operations: "Ice Operations",
  refrigeration: "Refrigeration",
  accident_reports: "Accident",
  air_quality: "Air Quality",
  incident_reports: "Incident",
  scheduling: "Scheduling",
}

export function sourceModuleLabel(value: string): string {
  if (value in SOURCE_MODULE_LABEL) {
    return SOURCE_MODULE_LABEL[value as AlertSourceModule]
  }
  return value
}

export function excerpt(value: string | null, max = 160): string {
  if (!value) return ""
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}
