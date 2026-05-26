// Local types for the Facility Paperwork (facility documents) admin module.
// The facility_documents table isn't in the generated Supabase types yet, so
// the row shape is declared here (matching migration 85).

export type FacilityDocumentRow = {
  id: string
  facility_id: string
  title: string
  description: string | null
  category: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
