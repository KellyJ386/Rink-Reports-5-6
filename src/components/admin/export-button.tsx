"use client"

import { Download } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * Per-module export trigger for admin list pages. Downloads a facility-scoped
 * CSV or PDF for `moduleKey` over the last `days` days via GET /api/exports
 * (which re-runs requireAdmin + module permission server-side). A "Custom
 * range" item deep-links to the full Exports admin page.
 */
export function ExportButton({
  moduleKey,
  days = 30,
  className,
}: {
  moduleKey: string
  days?: number
  className?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function download(format: "csv" | "pdf") {
    setBusy(true)
    try {
      const qs = new URLSearchParams({
        module: moduleKey,
        format,
        from: daysAgoIso(days),
        to: todayIso(),
      })
      const res = await fetch(`/api/exports?${qs.toString()}`, { method: "GET" })
      if (!res.ok) {
        let message = "Export failed."
        try {
          const body = (await res.json()) as { error?: string }
          if (body?.error) message = body.error
        } catch {
          // keep generic message
        }
        // List pages don't all have an inline error slot; surface via alert.
        window.alert(message)
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") ?? ""
      const match = /filename="([^"]+)"/.exec(disposition)
      const filename = match?.[1] ?? `${moduleKey}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      window.alert("Could not reach the export service. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}
      >
        <Download className="size-4" />
        {busy ? "Exporting…" : "Export"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Last {days} days</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => download("csv")}>Download CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => download("pdf")}>Download PDF</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/admin/exports")}>
          Custom range &amp; settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
