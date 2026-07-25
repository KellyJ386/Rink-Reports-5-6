-- =============================================================================
-- 00000000000210_audit_trigger_warn_on_skip.sql
--
-- audit_row_change() (migration 41) silently returned without writing an
-- audit entry when it could not resolve a facility_id for the changed row.
-- Never blocking the underlying DML is the right call — but a hole in the
-- audit trail must at least leave an operational trace. The skip branch now
-- RAISEs a WARNING naming the operation and table, so log monitoring can
-- catch unaudited mutations. Body otherwise identical to live.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_fac_col   text := coalesce(tg_argv[0], 'facility_id');
  v_action    text;
  v_before    jsonb;
  v_after     jsonb;
  v_facility  uuid;
  v_entity_id uuid;
  v_row       jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after  := to_jsonb(new);
    v_row    := v_after;
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_row    := v_after;
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_before := to_jsonb(old);
    v_after  := null;
    v_row    := v_before;
  else
    return coalesce(new, old);
  end if;

  begin
    v_facility := (v_row ->> v_fac_col)::uuid;
  exception when others then
    v_facility := null;
  end;

  begin
    v_entity_id := (v_row ->> 'id')::uuid;
  exception when others then
    v_entity_id := null;
  end;

  -- audit_logs.facility_id is NOT NULL. If we cannot resolve a tenant id
  -- (very unusual: orphaned row, table doesn't carry facility_id at all)
  -- skip the audit entry rather than failing the original DML — but say so
  -- in the server log. A silent skip here is a hole in the audit trail with
  -- no operational trace (the sign-in sheet with the lazy attendant).
  if v_facility is null then
    raise warning
      'audit_row_change: skipped audit entry for % on %.% (facility unresolvable)',
      tg_op, tg_table_schema, tg_table_name;
    return coalesce(new, old);
  end if;

  insert into public.audit_logs (
    facility_id,
    actor_user_id,
    actor_employee_id,
    action,
    entity_type,
    entity_id,
    before,
    after
  ) values (
    v_facility,
    auth.uid(),
    public.current_employee_id(),
    v_action,
    tg_table_name::text,
    v_entity_id,
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$function$

;
