"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ModuleOption = { key: string; label: string }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * Admin export runner: pick a module, format, and date range, then download a
 * facility-scoped CSV or PDF. Downloads go through GET /api/exports (which
 * re-checks requireAdmin + module permission server-side); we fetch as a blob
 * so server-side validation errors surface inline rather than navigating to a
 * raw JSON error page.
 */
export function RunExportPanel({ modules }: { modules: ModuleOption[] }) {
  const [moduleKey, setModuleKey] = useState<string>(modules[0]?.key ?? "")
  const [format, setFormat] = useState<"csv" | "pdf">("csv")
  const [from, setFrom] = useState<string>(daysAgoIso(30))
  const [to, setTo] = useState<string>(todayIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setError(null)
    if (!moduleKey) {
      setError("Choose a module to export.")
      return
    }
    setBusy(true)
    try {
      const qs = new URLSearchParams({ module: moduleKey, format, from, to })
      const res = await fetch(`/api/exports?${qs.toString()}`, {
        method: "GET",
        headers: { Accept: "application/octet-stream" },
      })
      if (!res.ok) {
        let message = "Export failed."
        try {
          const body = (await res.json()) as { error?: string }
          if (body?.error) message = body.error
        } catch {
          // non-JSON error body; keep generic message
        }
        setError(message)
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") ?? ""
      const match = /filename="([^"]+)"/.exec(disposition)
      const filename =
        match?.[1] ?? `${moduleKey}_${from}_to_${to}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError("Could not reach the export service. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run an export</CardTitle>
        <CardDescription>
          Download submissions for a module over a date range. Columns,
          delimiter, date format, and branding come from the settings below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export_module">Module</Label>
            <Select value={moduleKey} onValueChange={setModuleKey}>
              <SelectTrigger id="export_module">
                <SelectValue placeholder="Choose module" />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export_format">Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as "csv" | "pdf")}>
              <SelectTrigger id="export_format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export_from">From</Label>
            <Input
              id="export_from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export_to">To</Label>
            <Input
              id="export_to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div>
          <Button type="button" onClick={download} disabled={busy}>
            {busy ? "Generating…" : `Download ${format.toUpperCase()}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
