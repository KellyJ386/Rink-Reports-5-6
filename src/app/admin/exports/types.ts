export type ExportSettingsRow = {
  id: string
  facility_id: string
  logo_url: string | null
  header_text: string | null
  footer_text: string | null
  paper_size: "letter" | "a4"
  include_facility_name: boolean
  include_date: boolean
  include_submitted_by: boolean
  created_at: string
  updated_at: string | null
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export const PAPER_SIZES = [
  { value: "letter", label: "Letter (8.5 × 11 in)" },
  { value: "a4", label: "A4 (210 × 297 mm)" },
] as const
