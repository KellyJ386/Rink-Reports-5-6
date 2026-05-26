"use client"

import { useMemo, useState } from "react"
import { Download, FileText } from "lucide-react"

import { EmptyState } from "@/components/ui/empty-state"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FACILITY_DOCUMENT_CATEGORIES,
  facilityDocumentCategoryLabel,
  formatFileSize,
} from "@/lib/facility-documents"

export type BrowserDocument = {
  id: string
  title: string
  description: string | null
  category: string
  fileName: string
  sizeBytes: number | null
  createdAt: string
  downloadUrl: string | null
}

const ALL = "__all__"

export function DocumentsBrowser({
  documents,
}: {
  documents: BrowserDocument[]
}) {
  const [category, setCategory] = useState<string>(ALL)

  // Only offer categories that actually have documents, so the filter never
  // dead-ends on an empty selection.
  const presentCategories = useMemo(() => {
    const present = new Set(documents.map((d) => d.category))
    return FACILITY_DOCUMENT_CATEGORIES.filter((c) => present.has(c.key))
  }, [documents])

  const filtered = useMemo(
    () =>
      category === ALL
        ? documents
        : documents.filter((d) => d.category === category),
    [documents, category],
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-w-xs flex-col gap-2">
        <Label htmlFor="category-filter">Filter by Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="category-filter">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Categories</SelectItem>
            {presentCategories.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" aria-hidden />}
          title="No documents available"
          description="Your facility admin hasn't uploaded any documents yet."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" aria-hidden />}
          title="No documents in this category"
          description="Try a different category to see more documents."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((doc) => (
            <li key={doc.id}>
              <DocumentCard doc={doc} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DocumentCard({ doc }: { doc: BrowserDocument }) {
  const meta = [
    facilityDocumentCategoryLabel(doc.category),
    formatFileSize(doc.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground" title={doc.title}>
            {doc.title}
          </p>
          {meta ? (
            <p className="text-xs text-muted-foreground">{meta}</p>
          ) : null}
        </div>
      </div>

      {doc.description ? (
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {doc.description}
        </p>
      ) : null}

      <div className="mt-auto pt-1">
        {doc.downloadUrl ? (
          <a
            href={doc.downloadUrl}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">Unavailable</span>
        )}
      </div>
    </div>
  )
}
