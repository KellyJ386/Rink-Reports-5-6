"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Shared minimal CSV bulk-import card. Used by several admin config surfaces
// (incident activities, facility spaces, …). Each caller supplies a server
// action that parses + inserts and returns this result shape.
export type BulkImportResult =
  | { ok: true; inserted: number; skipped: number; errors: string[] }
  | { ok: false; error: string }

type Props = {
  title: string
  description: string
  placeholder: string
  action: (csv: string) => Promise<BulkImportResult>
}

export function BulkImportCard({
  title,
  description,
  placeholder,
  action,
}: Props) {
  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState("")
  const [pending, startTransition] = useTransition()

  function onImport() {
    if (!csv.trim()) {
      toast.error("Paste at least one row first.")
      return
    }
    startTransition(async () => {
      const result = await action(csv)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const parts = [`${result.inserted} added`]
      if (result.skipped > 0) parts.push(`${result.skipped} skipped (duplicates)`)
      toast.success(parts.join(", "))
      if (result.errors.length > 0) {
        toast.warning(
          `${result.errors.length} row(s) had problems: ${result.errors
            .slice(0, 3)
            .join(" ")}${result.errors.length > 3 ? " …" : ""}`,
        )
      }
      setCsv("")
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Bulk import (CSV)
      </Button>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          placeholder={placeholder}
          className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <Button type="button" onClick={onImport} disabled={pending}>
            {pending ? "Importing…" : "Import"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false)
              setCsv("")
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
