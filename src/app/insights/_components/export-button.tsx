"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

import { exportReportPdf } from "../_lib/export-report"
import type { ReportPeriod } from "../_lib/get-report"

/**
 * Converts the exportReportPdf action's base64 result into a browser
 * download — the same base64-action pattern admin/exports/actions.ts's
 * runExport already establishes ("exists for callers that prefer an action
 * result over a navigation"), rather than a second download mechanism.
 */
export function ExportButton({
  moduleKeys,
  period,
  anchorDate,
}: {
  moduleKeys: string[]
  period: ReportPeriod
  anchorDate: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setError(null)
    setBusy(true)
    try {
      const result = await exportReportPdf({ moduleKeys, period, anchorDate })
      if (!result.ok) {
        setError(result.error)
        return
      }
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: result.contentType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = result.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError("Could not generate the PDF. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" onClick={handleExport} disabled={busy || moduleKeys.length === 0}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        Export PDF
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
