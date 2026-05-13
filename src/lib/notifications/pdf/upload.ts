import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export const PDF_BUCKET = "notification-pdfs"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODULE_KEY_RE = /^[a-z0-9_]{1,64}$/

/**
 * Path layout: '<facility_id>/<source_module>/<source_record_id>.pdf'.
 * The first segment matches the storage.objects RLS check in migration 48
 * (foldername[1]::uuid = current_facility_id), so authenticated reads
 * stay scoped to the caller's facility automatically.
 *
 * Validates inputs to keep a regressed caller from producing a path that
 * traverses out of its facility folder. Service-role writes bypass RLS,
 * so we defensively reject anything that isn't a UUID / safe key here.
 */
export function pdfObjectPath(
  facilityId: string,
  sourceModule: string,
  sourceRecordId: string,
): string {
  if (!UUID_RE.test(facilityId)) {
    throw new Error(`pdfObjectPath: invalid facilityId`)
  }
  if (!UUID_RE.test(sourceRecordId)) {
    throw new Error(`pdfObjectPath: invalid sourceRecordId`)
  }
  if (!MODULE_KEY_RE.test(sourceModule)) {
    throw new Error(`pdfObjectPath: invalid sourceModule`)
  }
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
  const path = pdfObjectPath(facilityId, sourceModule, sourceRecordId) // throws on bad input
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
