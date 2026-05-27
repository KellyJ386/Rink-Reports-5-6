import type { ExportSettingsRow } from "@/app/admin/exports/types"

type DateFormat = ExportSettingsRow["date_format"]

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * Format an ISO timestamp using the facility's configured `date_format`,
 * appending the time as HH:MM (24h) when `withTime`. Returns "" for
 * null/unparseable input so empty cells stay empty rather than rendering a
 * literal "Invalid Date".
 */
export function formatExportDate(
  iso: string | null | undefined,
  dateFormat: DateFormat,
  withTime = true,
): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""

  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())

  let datePart: string
  switch (dateFormat) {
    case "DD/MM/YYYY":
      datePart = `${dd}/${mm}/${yyyy}`
      break
    case "YYYY-MM-DD":
      datePart = `${yyyy}-${mm}-${dd}`
      break
    case "MM/DD/YYYY":
    default:
      datePart = `${mm}/${dd}/${yyyy}`
      break
  }

  if (!withTime) return datePart
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
