import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export const PDF_BUCKET = "notification-pdfs"

/**
 * Path layout: '<facility_id>/<source_module>/<source_record_id>.pdf'.
 * The first segment matches the storage.objects RLS check in migration 48
 * (foldername[1]::uuid = current_facility_id), so authenticated reads
 * stay scoped to the caller's facility automatically.
 */
export function pdfObjectPath(
  facilityId: string,
  sourceModule: string,
  sourceRecordId: string,
): string {
  return `${facilityId}/${sourceModule}/${sourceRecordId}.pdf`
}

/**
 * Upload a rendered PDF buffer with service-role credentials. Overwrites
 * existing objects at the same path so re-runs (e.g. after the source
 * record changes) replace the previous PDF rather than accumulating.
 */
export async function uploadSubmissionPdf(
  serviceRoleClient: SupabaseClient,
  facilityId: string,
  sourceModule: string,
  sourceRecordId: string,
  buffer: Buffer,
): Promise<string> {
  const path = pdfObjectPath(facilityId, sourceModule, sourceRecordId)
  const { error } = await serviceRoleClient.storage
    .from(PDF_BUCKET)
    .upload(path, buffer, {
      contentType: "application/pdf",
      upsert: true,
    })
  if (error) throw new Error(`PDF upload failed: ${error.message}`)
  return path
}

/**
 * Generate a short-lived signed URL for the inbox UI. Default TTL is
 * 5 minutes — long enough to click the link, short enough to be useless
 * if leaked. Returns null when the object is missing or signing fails so
 * the UI degrades to a plain "no PDF" state instead of a broken link.
 */
export async function signPdfUrl(
  sb: SupabaseClient,
  path: string,
  expiresInSeconds: number = 300,
): Promise<string | null> {
  const { data, error } = await sb.storage
    .from(PDF_BUCKET)
    .createSignedUrl(path, expiresInSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
