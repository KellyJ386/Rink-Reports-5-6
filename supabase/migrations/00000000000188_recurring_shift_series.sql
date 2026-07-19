-- =============================================================================
-- 00000000000188_recurring_shift_series.sql
--
-- Cross-tenant hardening for schedule_shifts.recurring_parent_id, ahead of the
-- native "recurring shift series" feature (a series of generated occurrences
-- all pointing back at a root/parent shift via recurring_parent_id).
--
-- Migration 15 defined recurring_parent_id as a single-column self-FK:
--
--   recurring_parent_id uuid references public.schedule_shifts(id)
--     on delete set null
--
-- That FK only checks that the referenced id EXISTS somewhere in
-- schedule_shifts — it says nothing about which facility the parent belongs
-- to. Nothing at the DB boundary stopped a Facility-A child shift from being
-- inserted with recurring_parent_id pointing at a Facility-B shift's id (both
-- are valid uuids in the same global id space). RLS still hides the foreign
-- row from ordinary reads, but the FK itself is a silent cross-tenant link: a
-- crafted PostgREST insert (or a bug in the future recurring-series generator)
-- could parent a Facility-A occurrence to a Facility-B root, and any query
-- that walks the parent link (e.g. "delete this whole series") would then
-- reach across facilities.
--
-- Fix: replace the single-column FK with a COMPOSITE FK
-- (recurring_parent_id, facility_id) -> schedule_shifts(id, facility_id).
-- Postgres requires the referenced columns to be covered by a unique
-- index/constraint, hence the new schedule_shifts_id_facility_key unique
-- index on (id, facility_id) (id is already globally unique via the primary
-- key, so this composite index is redundant for uniqueness purposes but is
-- exactly the index the composite FK needs as its target). With this in
-- place, a child row's facility_id is now REQUIRED to match its parent's
-- facility_id at insert/update time -- Postgres itself rejects the
-- cross-facility link, not just RLS-scoped reads.
--
-- The FK constraint is dropped and RE-ADDED WITH THE SAME NAME
-- (schedule_shifts_recurring_parent_id_fkey) so the composite FK definition
-- lands in the same generated-types relationship slot as the original
-- single-column FK (only its `columns` / `referencedColumns` arrays grow from
-- ["recurring_parent_id"] to ["recurring_parent_id","facility_id"]),
-- minimizing unrelated churn in src/types/database.ts.
--
-- ON DELETE behavior: a plain composite `on delete set null` would null out
-- BOTH columns when the parent is deleted, but facility_id is NOT NULL, so a
-- blanket SET NULL would itself violate that constraint. Postgres 15+ supports
-- a column list on SET NULL / SET DEFAULT actions
-- (`on delete set null (recurring_parent_id)`), which nulls only
-- recurring_parent_id and leaves facility_id untouched -- exactly the original
-- single-column semantics. CI's rls-isolation workflow pins
-- `supabase/postgres:15.1.1.78` (see .github/workflows/rls-isolation.yml), so
-- the column-list form is supported there.
-- =============================================================================

-- Composite unique index the FK below targets. id is already unique (primary
-- key); this index exists solely so (id, facility_id) is a valid FK target.
create unique index if not exists schedule_shifts_id_facility_key
  on public.schedule_shifts (id, facility_id);

-- Replace the single-column self-FK with a facility-fenced composite FK, kept
-- under the SAME constraint name.
alter table public.schedule_shifts
  drop constraint if exists schedule_shifts_recurring_parent_id_fkey;

alter table public.schedule_shifts
  add constraint schedule_shifts_recurring_parent_id_fkey
  foreign key (recurring_parent_id, facility_id)
  references public.schedule_shifts (id, facility_id)
  on delete set null (recurring_parent_id);

comment on column public.schedule_shifts.recurring_parent_id is
  'Optional link from a generated occurrence to a parent/root shift in a recurring series. Facility-fenced via a composite FK (recurring_parent_id, facility_id) -> schedule_shifts(id, facility_id): a child can only ever reference a parent in its OWN facility, so a crafted or buggy insert can no longer parent a shift onto another facility''s row.';

-- Series lookups ("give me every occurrence generated from this root") filter
-- on recurring_parent_id; index it (partial, since most shifts are not part
-- of a series) so that stays cheap as scheduling data grows.
create index if not exists schedule_shifts_recurring_parent_idx
  on public.schedule_shifts (recurring_parent_id)
  where recurring_parent_id is not null;
