-- =============================================================================
-- 00000000000219_audit_logs_partitioning_pilot.sql
--
-- Phase-5 pilot (docs/phase5-partitioning-plan.md): convert audit_logs to a
-- RANGE-partitioned table keyed on created_at. audit_logs is the pilot — pure
-- append, no inbound FKs, fastest growth.
--
-- WHY: at scale the append-only, 7-year-retained audit log dominates both
-- purge cost (row-by-row DELETE churn) and scan cost (admin views filter
-- created_at windows). Partitioning gives the planner partition pruning now
-- and makes an eventual whole-partition-drop retention near-instant later.
--
-- WHAT CHANGES / WHAT DOESN'T:
--   * Storage becomes partitioned; the hash chain (214), append-only guard
--     (214), identity `seq`, RLS, FKs, and grants are all preserved across the
--     cutover — verify_all_audit_chains() must stay green afterward.
--   * RETENTION IS UNCHANGED: the per-facility staged purge (213/214) still
--     runs. This pilot does NOT switch to whole-partition-drop retention —
--     that needs the deferred product decision (may facilities keep different
--     audit windows?). So per-facility keep_days is still honored.
--
-- SCHEME: **yearly** partitions over a fixed, deterministic 2023–2035 window
-- plus a DEFAULT catch-all. Yearly (not monthly) keeps the pilot's partition
-- set small and the schema snapshot stable; the production rollout can adopt
-- monthly partitions via pg_partman (per the plan). The DEFAULT partition
-- guarantees an insert NEVER fails for an out-of-window created_at — critical,
-- because a failed audit insert would fail the underlying DML.
--
-- SAFETY: this is a maintenance-window cutover (brief exclusive lock during
-- the swap) and is NOT cleanly reversible (rollback = PITR). It is isolated to
-- its own migration prefix so it can ship in a later release than 208–218.
-- Legacy objects are renamed aside (not reusing names) so the rebuild can't
-- collide, then dropped at the end.
-- =============================================================================

-- 1. Move the current table + all its named objects out of the way.
alter table public.audit_logs rename to audit_logs_legacy;
alter table public.audit_logs_legacy rename constraint audit_logs_pkey to audit_logs_legacy_pkey;
alter table public.audit_logs_legacy rename constraint audit_logs_facility_id_fkey to audit_logs_legacy_facility_id_fkey;
alter table public.audit_logs_legacy rename constraint audit_logs_actor_user_id_fkey to audit_logs_legacy_actor_user_id_fkey;
alter table public.audit_logs_legacy rename constraint audit_logs_actor_employee_id_fkey to audit_logs_legacy_actor_employee_id_fkey;
alter index public.idx_audit_logs_facility_id      rename to idx_audit_logs_legacy_facility_id;
alter index public.idx_audit_logs_actor_user_id    rename to idx_audit_logs_legacy_actor_user_id;
alter index public.idx_audit_logs_entity           rename to idx_audit_logs_legacy_entity;
alter index public.idx_audit_logs_created_at        rename to idx_audit_logs_legacy_created_at;
alter index public.idx_audit_logs_facility_created  rename to idx_audit_logs_legacy_facility_created;
alter index public.idx_audit_logs_facility_seq      rename to idx_audit_logs_legacy_facility_seq;
alter sequence public.audit_logs_seq_seq rename to audit_logs_legacy_seq_seq;
-- Detach the legacy triggers so they don't fire during the copy-out.
alter table public.audit_logs_legacy disable trigger trg_audit_logs_hash_chain;
alter table public.audit_logs_legacy disable trigger trg_audit_logs_append_only;

-- 2. New partitioned parent. seq starts as a plain column so the copy can
--    carry the existing values verbatim; it becomes identity in step 5.
create table public.audit_logs (
  id                 uuid not null default gen_random_uuid(),
  facility_id        uuid not null,
  actor_user_id      uuid,
  actor_employee_id  uuid,
  action             text not null,
  entity_type        text not null,
  entity_id          uuid,
  before             jsonb,
  after              jsonb,
  ip                 inet,
  user_agent         text,
  created_at         timestamptz not null default now(),
  seq                bigint not null,
  prev_hash          text,
  row_hash           text,
  constraint audit_logs_pkey primary key (id, created_at)
) partition by range (created_at);

comment on table public.audit_logs is
  'Append-only audit trail (migration 2), hash-chained + append-only (214), '
  'RANGE-partitioned by created_at (yearly, migration 219). No UPDATE/DELETE '
  'except the governed retention-staging bypass.';

alter table public.audit_logs
  add constraint audit_logs_facility_id_fkey
    foreign key (facility_id) references public.facilities(id) on delete restrict,
  add constraint audit_logs_actor_user_id_fkey
    foreign key (actor_user_id) references public.users(id) on delete set null,
  add constraint audit_logs_actor_employee_id_fkey
    foreign key (actor_employee_id) references public.employees(id) on delete set null;

-- 3. Fixed yearly partitions 2023–2035 + DEFAULT catch-all (deterministic;
--    no now() so the schema snapshot is stable run-to-run).
do $$
declare
  y int;
begin
  for y in 2023..2035 loop
    execute format(
      'create table public.audit_logs_y%s partition of public.audit_logs '
      || 'for values from (%L) to (%L)',
      y,
      make_timestamptz(y,     1, 1, 0, 0, 0, 'UTC'),
      make_timestamptz(y + 1, 1, 1, 0, 0, 0, 'UTC'));
  end loop;
end $$;
create table public.audit_logs_default partition of public.audit_logs default;

-- 4. Copy every legacy row verbatim (no triggers on the new table yet, so
--    seq / prev_hash / row_hash are preserved exactly — the chain is intact).
insert into public.audit_logs
  (id, facility_id, actor_user_id, actor_employee_id, action, entity_type,
   entity_id, before, after, ip, user_agent, created_at, seq, prev_hash, row_hash)
select
   id, facility_id, actor_user_id, actor_employee_id, action, entity_type,
   entity_id, before, after, ip, user_agent, created_at, seq, prev_hash, row_hash
from public.audit_logs_legacy;

-- 5. Make seq identity again, continuing past the copied max so new inserts
--    never collide with a preserved seq.
do $$
declare
  v_next bigint;
begin
  select coalesce(max(seq), 0) + 1 into v_next from public.audit_logs;
  execute format(
    'alter table public.audit_logs alter column seq '
    || 'add generated always as identity (restart with %s)', v_next);
end $$;

-- 6. Secondary indexes (canonical names now free; propagate to all partitions).
create index idx_audit_logs_facility_id     on public.audit_logs (facility_id);
create index idx_audit_logs_actor_user_id   on public.audit_logs (actor_user_id);
create index idx_audit_logs_entity          on public.audit_logs (entity_type, entity_id);
create index idx_audit_logs_created_at      on public.audit_logs (created_at desc);
create index idx_audit_logs_facility_created on public.audit_logs (facility_id, created_at desc);
create index idx_audit_logs_facility_seq    on public.audit_logs (facility_id, seq desc);

-- 7. RLS + policies (identical to the pre-cutover table).
alter table public.audit_logs enable row level security;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.is_super_admin() or (facility_id = public.current_facility_id()));
create policy audit_logs_select on public.audit_logs
  for select
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.current_user_role() = any (array['admin', 'super_admin'])));

-- 8. Re-attach the chain + append-only triggers on the partitioned parent
--    (row triggers on a partitioned parent apply to every partition, PG13+).
create trigger trg_audit_logs_hash_chain
  before insert on public.audit_logs
  for each row execute function public.audit_logs_hash_chain();
create trigger trg_audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();

-- 9. Grants (match the pre-cutover table; RLS + the append-only trigger remain
--    the real gates). Snapshot drift oracle dumps --no-privileges, so these
--    don't affect the committed snapshot.
grant select, insert, update, delete on public.audit_logs to anon, authenticated, service_role;

-- 10. Retire the legacy table (its renamed indexes/constraints/sequence go too).
drop table public.audit_logs_legacy;
