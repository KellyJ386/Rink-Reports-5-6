-- =============================================================================
-- 00000000000240_scope_storage_delete_policies.sql
--
-- Scope the two early storage DELETE policies to their own buckets.
--
-- Policies on storage.objects are permissive and OR'd across every bucket, so
-- a policy whose USING clause omits bucket_id applies to ALL objects in ALL
-- buckets. notif_pdfs_delete (48) and facility_docs_delete (85) both did
-- exactly that: each granted super admins DELETE on every object anywhere,
-- not just in the bucket the policy is named after. rink_logos_delete (199)
-- was written correctly (`bucket_id = 'rink-logos' and is_super_admin()`);
-- this migration backfills the same shape onto the two older policies.
--
-- Behavior change: none intended for the named buckets — super admins keep
-- DELETE there. What disappears is the accidental cross-bucket grant.
-- Storage policies live outside the `public` schema, so the drift snapshot
-- (dump --schema=public) is unaffected.
-- =============================================================================

drop policy if exists notif_pdfs_delete on storage.objects;
create policy notif_pdfs_delete
  on storage.objects
  for delete to authenticated
  using (bucket_id = 'notification-pdfs' and public.is_super_admin());

drop policy if exists facility_docs_delete on storage.objects;
create policy facility_docs_delete
  on storage.objects
  for delete to authenticated
  using (bucket_id = 'facility-documents' and public.is_super_admin());
