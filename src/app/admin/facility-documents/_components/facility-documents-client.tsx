"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FileText, Pencil, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  FACILITY_DOCUMENT_CATEGORIES,
  facilityDocumentCategoryLabel,
  formatFileSize,
} from "@/lib/facility-documents"

import {
  deleteDocument,
  setDocumentActive,
  updateDocument,
  uploadDocuments,
} from "../actions"
import type { FacilityDocumentRow } from "../types"

export function FacilityDocumentsClient({
  facilityId,
  documents,
}: {
  facilityId: string
  documents: FacilityDocumentRow[]
}) {
  return (
    <div className="flex flex-col gap-6">
      <UploadCard facilityId={facilityId} />
      <DocumentsList facilityId={facilityId} documents={documents} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bulk upload
// ---------------------------------------------------------------------------

function UploadCard({ facilityId }: { facilityId: string }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [category, setCategory] = useState<string>("")
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!category) {
      toast.error("Choose a category first.")
      return
    }
    if (selectedNames.length === 0) {
      toast.error("Choose at least one file to upload.")
      return
    }
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await uploadDocuments({ ok: null }, formData)
      if (result.ok) {
        toast.success(result.message ?? "Documents uploaded.")
        formRef.current?.reset()
        setCategory("")
        setSelectedNames([])
        router.refresh()
      } else if (result.ok === false) {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-lg font-semibold tracking-tight">Bulk Upload</h2>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input type="hidden" name="facility_id" value={facilityId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="upload-category">Category</Label>
            <Select
              name="category"
              value={category}
              onValueChange={setCategory}
              required
            >
              <SelectTrigger id="upload-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {FACILITY_DOCUMENT_CATEGORIES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="upload-files">Files</Label>
            <Input
              id="upload-files"
              name="files"
              type="file"
              multiple
              className="h-12 cursor-pointer py-2.5 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(e) =>
                setSelectedNames(
                  Array.from(e.target.files ?? []).map((f) => f.name),
                )
              }
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="upload-description">Description (optional)</Label>
          <Textarea
            id="upload-description"
            name="description"
            rows={2}
            placeholder="Applied to every file in this upload."
            className="text-base"
          />
        </div>

        {selectedNames.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {selectedNames.length} file
            {selectedNames.length === 1 ? "" : "s"} selected:{" "}
            <span className="text-foreground">{selectedNames.join(", ")}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            PDF, Word, Excel, PowerPoint, text, or image files up to 25 MB each.
          </p>
        )}

        <div>
          <Button type="submit" disabled={pending}>
            <Upload className="h-4 w-4" aria-hidden />
            {pending ? "Uploading…" : "Upload documents"}
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Documents list
// ---------------------------------------------------------------------------

function DocumentsList({
  facilityId,
  documents,
}: {
  facilityId: string
  documents: FacilityDocumentRow[]
}) {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-6 w-6" aria-hidden />}
        title="No documents yet"
        description="Upload your first documents above. They'll appear here and on the staff Facility Paperwork page."
      />
    )
  }

  // Group by category, preserving the canonical category order.
  const byCategory = new Map<string, FacilityDocumentRow[]>()
  for (const doc of documents) {
    const bucket = byCategory.get(doc.category) ?? []
    bucket.push(doc)
    byCategory.set(doc.category, bucket)
  }
  const orderedKeys = [
    ...FACILITY_DOCUMENT_CATEGORIES.map((c) => c.key).filter((k) =>
      byCategory.has(k),
    ),
    ...[...byCategory.keys()].filter(
      (k) => !FACILITY_DOCUMENT_CATEGORIES.some((c) => c.key === k),
    ),
  ]

  return (
    <div className="flex flex-col gap-6">
      {orderedKeys.map((key) => (
        <section key={key} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {facilityDocumentCategoryLabel(key)}
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
            {(byCategory.get(key) ?? []).map((doc) => (
              <li key={doc.id}>
                <DocumentRow facilityId={facilityId} doc={doc} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function DocumentRow({
  facilityId,
  doc,
}: {
  facilityId: string
  doc: FacilityDocumentRow
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()

  const meta = [formatFileSize(doc.size_bytes), doc.file_name]
    .filter(Boolean)
    .join(" · ")

  const runAction = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        router.refresh()
      } else {
        toast.error(result.error ?? "Action failed.")
      }
    })

  if (editing) {
    return (
      <EditRow
        facilityId={facilityId}
        doc={doc}
        onDone={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium" title={doc.title}>
              {doc.title}
            </p>
            {!doc.is_active ? (
              <Badge variant="secondary">Hidden</Badge>
            ) : null}
          </div>
          {meta ? (
            <p className="truncate text-xs text-muted-foreground">{meta}</p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            runAction(() =>
              setDocumentActive(facilityId, doc.id, !doc.is_active),
            )
          }
        >
          {doc.is_active ? "Hide" : "Show"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" aria-hidden />
          Edit
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                `Delete "${doc.title}"? This permanently removes the file.`,
              )
            ) {
              return
            }
            runAction(() => deleteDocument(facilityId, doc.id))
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Delete
        </Button>
      </div>
    </div>
  )
}

function EditRow({
  facilityId,
  doc,
  onDone,
}: {
  facilityId: string
  doc: FacilityDocumentRow
  onDone: () => void
}) {
  const router = useRouter()
  const [category, setCategory] = useState<string>(doc.category)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateDocument({ ok: null }, formData)
      if (result.ok) {
        toast.success(result.message ?? "Document updated.")
        router.refresh()
        onDone()
      } else if (result.ok === false) {
        toast.error(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-4 py-3">
      <input type="hidden" name="facility_id" value={facilityId} />
      <input type="hidden" name="id" value={doc.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`title-${doc.id}`}>Title</Label>
          <Input
            id={`title-${doc.id}`}
            name="title"
            defaultValue={doc.title}
            required
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`category-${doc.id}`}>Category</Label>
          <Select
            name="category"
            value={category}
            onValueChange={setCategory}
            required
          >
            <SelectTrigger id={`category-${doc.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FACILITY_DOCUMENT_CATEGORIES.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`description-${doc.id}`}>Description (optional)</Label>
        <Textarea
          id={`description-${doc.id}`}
          name="description"
          rows={2}
          defaultValue={doc.description ?? ""}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </Button>
      </div>
    </form>
  )
}
