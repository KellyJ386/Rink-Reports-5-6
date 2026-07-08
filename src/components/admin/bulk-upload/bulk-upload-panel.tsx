"use client"

import { useRef, useState, useTransition } from "react"
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import type { ImportSchema, ValidatedRow } from "./types"
import { mapHeaders, validateRows, type RowResult } from "./validate"

// `./parse` and `./template` statically import "exceljs" (~1MB minified).
// They are imported dynamically inside event handlers below so exceljs is only
// fetched on file-pick or template-download — never at render / on initial load.

type Props = {
  schema: ImportSchema
  triggerLabel?: string
  /** Called after a successful import (in addition to a router refresh). */
  onImported?: () => void
  disabled?: boolean
}

// Legacy .xls (BIFF) is not supported: exceljs only reads OOXML (.xlsx).
const ACCEPT = ".csv,.xlsx"

export function BulkUploadPanel({
  schema,
  triggerLabel = "Bulk upload",
  onImported,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        {triggerLabel}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl"
        >
          {open && (
            <PanelBody
              schema={schema}
              onClose={() => setOpen(false)}
              onImported={onImported}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function PanelBody({
  schema,
  onClose,
  onImported,
}: {
  schema: ImportSchema
  onClose: () => void
  onImported?: () => void
}) {
  const mode = schema.mode ?? "strict"
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([])
  const [missingRequired, setMissingRequired] = useState<string[]>([])
  const [results, setResults] = useState<RowResult[] | null>(null)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [importing, startImport] = useTransition()

  const validCount = results?.filter((r) => r.ok).length ?? 0
  const errorCount = results?.filter((r) => !r.ok).length ?? 0
  const hasBlockingHeaderError = missingRequired.length > 0
  const canImport =
    !hasBlockingHeaderError &&
    validCount > 0 &&
    (mode === "partial" || errorCount === 0)

  async function handleFile(file: File) {
    // Drag-and-drop bypasses the input's `accept` filter; reject legacy .xls
    // explicitly since exceljs cannot read the old binary format.
    if (/\.xls$/i.test(file.name)) {
      toast.error(
        "Legacy .xls files aren't supported. Save as .xlsx or .csv and try again.",
      )
      return
    }
    setParsing(true)
    setResults(null)
    setFileName(file.name)
    try {
      // Lazy-load the exceljs-backed parser only when a file is actually picked.
      const { parseFile } = await import("./parse")
      const parsed = await parseFile(file)
      if (parsed.headers.length === 0) {
        toast.error("That file appears to be empty.")
        setResults([])
        setUnknownHeaders([])
        setMissingRequired([])
        return
      }
      const mapping = mapHeaders(parsed.headers, schema.columns)
      setUnknownHeaders(mapping.unknownHeaders)
      setMissingRequired(mapping.missingRequired)
      if (mapping.missingRequired.length > 0) {
        setResults([])
        return
      }
      setResults(validateRows(parsed, schema.columns, schema.zodRow, mapping))
    } catch {
      toast.error("Could not read that file. Use the downloadable template.")
      setResults([])
    } finally {
      setParsing(false)
    }
  }

  function reset() {
    setFileName(null)
    setResults(null)
    setUnknownHeaders([])
    setMissingRequired([])
    if (inputRef.current) inputRef.current.value = ""
  }

  // Lazy-load the exceljs-backed template generator only on download click.
  async function handleTemplateDownload(format: "xlsx" | "csv") {
    setDownloadingTemplate(true)
    try {
      const mod = await import("./template")
      if (format === "xlsx") {
        await mod.downloadTemplateXlsx(schema.columns, schema.surfaceId)
      } else {
        mod.downloadTemplateCsv(schema.columns, schema.surfaceId)
      }
    } catch {
      toast.error("Could not generate the template. Try again.")
    } finally {
      setDownloadingTemplate(false)
    }
  }

  function confirmImport() {
    if (!results) return
    const rows: ValidatedRow[] = results
      .filter((r) => r.ok)
      .map((r) => ({ rowNumber: r.rowNumber, values: r.values }))
    startImport(async () => {
      const res = await schema.onImport(rows)
      if (res.ok) {
        toast.success(res.message ?? `Imported ${res.inserted} row(s).`)
        onImported?.()
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Bulk upload</SheetTitle>
        <SheetDescription>
          Import a CSV or Excel file. Download the template for the exact
          columns, fill it in, then upload to preview before saving.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloadingTemplate}
          onClick={() => void handleTemplateDownload("xlsx")}
        >
          <Download className="mr-1.5 h-4 w-4" />
          Template (.xlsx)
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloadingTemplate}
          onClick={() => void handleTemplateDownload("csv")}
        >
          <Download className="mr-1.5 h-4 w-4" />
          Template (.csv)
        </Button>
      </div>

      <label
        className="border-input hover:bg-muted/40 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) void handleFile(f)
        }}
      >
        <FileText className="text-muted-foreground h-6 w-6" />
        <span className="text-sm font-medium">
          {fileName ?? "Drop a file here or click to choose"}
        </span>
        <span className="text-muted-foreground text-xs">
          Accepts .csv, .xlsx
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
      </label>

      {parsing && (
        <p className="text-muted-foreground text-sm">Reading file…</p>
      )}

      {missingRequired.length > 0 && (
        <p
          role="alert"
          className="text-destructive flex items-start gap-1.5 text-sm"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Missing required column(s): {missingRequired.join(", ")}. Download
            the template for the expected headers.
          </span>
        </p>
      )}

      {unknownHeaders.length > 0 && (
        <p className="text-muted-foreground flex items-start gap-1.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Ignored unrecognized column(s): {unknownHeaders.join(", ")}.</span>
        </p>
      )}

      {results && results.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-success-soft-foreground inline-flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              {validCount} valid
            </span>
            {errorCount > 0 && (
              <span className="text-destructive inline-flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {errorCount} error{errorCount === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <div className="overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/60 sticky top-0">
                <tr>
                  <th className="border-b px-2 py-1.5 text-left font-medium">
                    #
                  </th>
                  <th className="border-b px-2 py-1.5 text-left font-medium">
                    Status
                  </th>
                  {schema.columns.map((c) => (
                    <th
                      key={c.key}
                      className="border-b px-2 py-1.5 text-left font-medium"
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.rowNumber}
                    className={cn(!r.ok && "bg-destructive/5")}
                  >
                    <td className="text-muted-foreground border-b px-2 py-1.5 align-top tabular-nums">
                      {r.rowNumber}
                    </td>
                    <td className="border-b px-2 py-1.5 align-top">
                      {r.ok ? (
                        <span className="text-success-soft-foreground inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> ok
                        </span>
                      ) : (
                        <span className="text-destructive inline-flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" /> error
                          </span>
                          {r.errors.map((e, i) => (
                            <span key={i} className="text-xs">
                              {e}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    {schema.columns.map((c) => (
                      <td
                        key={c.key}
                        className="border-b px-2 py-1.5 align-top"
                      >
                        {formatValue(r.values[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-2 flex items-center justify-end gap-2">
        {results && (
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            disabled={importing}
          >
            Clear
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={importing}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={confirmImport}
          disabled={!canImport || importing}
        >
          {importing
            ? "Importing…"
            : mode === "partial" && errorCount > 0
              ? `Import ${validCount} valid`
              : `Import ${validCount} row${validCount === 1 ? "" : "s"}`}
        </Button>
      </div>
    </>
  )
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—"
  if (typeof v === "boolean") return v ? "true" : "false"
  return String(v)
}
