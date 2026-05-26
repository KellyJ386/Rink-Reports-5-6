// Shared constants + helpers for the Facility Paperwork module. Framework
// agnostic (imported by server actions, the staff browse page, and client
// components) — keep it free of "server-only" / "use client" imports.

export const FACILITY_DOCUMENT_CATEGORIES = [
  { key: "emergency_action_plan", label: "Emergency Action Plan" },
  { key: "employee_handbook", label: "Employee Handbook" },
  { key: "staff_manual", label: "Staff Manual" },
  { key: "policy_document", label: "Policy Document" },
  { key: "safety_document", label: "Safety Document" },
  { key: "other", label: "Other" },
] as const

export type FacilityDocumentCategory =
  (typeof FACILITY_DOCUMENT_CATEGORIES)[number]["key"]

const CATEGORY_LABELS: Record<FacilityDocumentCategory, string> =
  Object.fromEntries(
    FACILITY_DOCUMENT_CATEGORIES.map((c) => [c.key, c.label]),
  ) as Record<FacilityDocumentCategory, string>

export function isFacilityDocumentCategory(
  value: string,
): value is FacilityDocumentCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value)
}

export function facilityDocumentCategoryLabel(value: string): string {
  return isFacilityDocumentCategory(value) ? CATEGORY_LABELS[value] : "Other"
}

// Upload constraints. Kept deliberately permissive (common office/document and
// image formats) but bounded so a single upload can't exhaust storage.
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024 // 25 MB

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
] as const

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  if (dot < 0 || dot === fileName.length - 1) return ""
  return fileName.slice(dot + 1).toLowerCase()
}

export function isAllowedDocumentExtension(fileName: string): boolean {
  const ext = fileExtension(fileName)
  return (ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)
}

// Sanitize an uploaded filename into a storage-safe object segment. Keeps the
// extension, strips path separators and anything outside a conservative set.
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 120)
  return cleaned.length > 0 ? cleaned : "document"
}

// Strip the extension for a default human title derived from a filename.
export function titleFromFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? fileName).trim()
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.replace(/[_-]+/g, " ").trim().slice(0, 200) || "Untitled document"
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}
