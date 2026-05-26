-- =============================================================================
-- 00000000000085_facility_documents.sql
--
-- Facility Paperwork module: per-facility library of documents, policies, and
-- manuals that staff can browse + download and that admins manage (incl. bulk
-- upload).
--
-- Adds:
--   - public.facility_documents (metadata rows; the file bytes live in storage)
--   - storage bucket 'facility-documents' (private)
--   - storage.objects RLS for that bucket — authenticated reads scoped to the
--     caller's facility (path layout "<facility_id>/<document_id>/<file>"),
--     writes restricted to service-role (admin uploads go through a
--     requireAdmin()-gated server action using the service-role client).
--
-- Access model:
--   - SELECT: any active employee whose facility matches the row (browse page),
--     plus super admins.
--   - INSERT/UPDATE/DELETE: super admins or facility admins (defense in depth —
--     the app performs these writes with the service-role client which bypasses
--     RLS, but ordinary authenticated clients must not be able to mutate).
-- =============================================================================

create table if not exists public.facility_documents (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  title        text not null,
  description  text,
  category     text not null
    check (category in (
      'emergency_action_plan',
      'employee_handbook',
      'staff_manual',
      'policy_document',
      'safety_document',
      'other'
    )),
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references public.employees(id) on delete set null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (storage_path)
);

comment on table public.facility_documents is
  'Per-facility library of uploaded documents (policies, manuals, emergency '
  'action plans). The file bytes live in the facility-documents storage '
  'bucket; this table holds the browsable metadata.';

create index if not exists idx_facility_documents_facility_active
  on public.facility_documents (facility_id, is_active, category, sort_order);

drop trigger if exists trg_facility_documents_updated_at on public.facility_documents;
create trigger trg_facility_documents_updated_at
  before update on public.facility_documents
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.facility_documents enable row level security;

drop policy if exists facility_documents_select on public.facility_documents;
create policy facility_documents_select on public.facility_documents
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_documents_insert on public.facility_documents;
create policy facility_documents_insert on public.facility_documents
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.is_facility_admin(facility_id)
  );

drop policy if exists facility_documents_update on public.facility_documents;
create policy facility_documents_update on public.facility_documents
  for update to authenticated
  using (
    public.is_super_admin()
    or public.is_facility_admin(facility_id)
  )
  with check (
    public.is_super_admin()
    or public.is_facility_admin(facility_id)
  );

drop policy if exists facility_documents_delete on public.facility_documents;
create policy facility_documents_delete on public.facility_documents
  for delete to authenticated
  using (
    public.is_super_admin()
    or public.is_facility_admin(facility_id)
  );

-- -----------------------------------------------------------------------------
-- Storage bucket. Private — RLS on storage.objects controls access.
--
-- The EXECUTE guard mirrors migration 48: the `public` column on
-- storage.buckets is missing on the older storage schema bundled with the CI
-- supabase/postgres image, so the INSERT text must only be parsed when its
-- branch actually runs. Either branch yields the same private bucket.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage'
       and table_name   = 'buckets'
       and column_name  = 'public'
  ) then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('facility-documents', 'facility-documents', false)
      on conflict (id) do nothing
    $sql$;
  else
    execute $sql$
      insert into storage.buckets (id, name)
      values ('facility-documents', 'facility-documents')
      on conflict (id) do nothing
    $sql$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- storage.objects RLS for this bucket only.
--
-- Path layout: '<facility_uuid>/<document_uuid>/<file_name>'. The first
-- segment IS the facility id; storage.foldername(name)[1] is the standard
-- Supabase pattern and matches the facility_documents.storage_path layout the
-- upload action writes.
-- -----------------------------------------------------------------------------
drop policy if exists facility_docs_select on storage.objects;
create policy facility_docs_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'facility-documents'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1]::uuid = public.current_facility_id()
    )
  );

-- Writes are restricted to service-role / postgres. The admin upload + delete
-- server actions use the service-role key; ordinary authenticated callers have
-- no write access.
drop policy if exists facility_docs_insert on storage.objects;
create policy facility_docs_insert
  on storage.objects
  for insert to authenticated
  with check (false);

drop policy if exists facility_docs_update on storage.objects;
create policy facility_docs_update
  on storage.objects
  for update to authenticated
  using (false);

drop policy if exists facility_docs_delete on storage.objects;
create policy facility_docs_delete
  on storage.objects
  for delete to authenticated
  using (public.is_super_admin());
