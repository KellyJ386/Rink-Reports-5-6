-- =============================================================================
-- 00000000000254_rink_payments_void_invoice_guard.sql
-- Refuse a payment recorded against a VOID invoice at the trigger layer.
--
-- WHY, given RLS already refuses it. The rink_payments INSERT policy carries
-- `and i.status <> 'void'`, and the server action checks it too, so no ordinary
-- user can do this. But a payment against a void invoice is a genuine
-- corruption — it inflates amount_paid on a document that states nothing is
-- owed, and the aging report and customer statement both read from that sum —
-- and the two existing controls both live in front of the database rather than
-- in it. Direct SQL from an owner session bypasses both.
--
-- This repo already treats money locks as needing two layers: rink_payments
-- are append-only via BOTH the absent UPDATE/DELETE policies AND
-- rink_payments_guard (migration 248), and the RLS harness asserts each layer
-- separately. This closes the same gap on the insert side, and was found by
-- exactly that kind of two-layer test.
--
-- The exemption tier is unchanged: super admin, the service role, or an owner
-- who explicitly sets rr.rink_scheduling_guard_bypass. `postgres` on its own is
-- NOT exempt, which is the whole point.
-- =============================================================================

begin;

create or replace function public.rink_payments_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if public.rink_scheduling_guard_exempt() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    -- A void invoice states that nothing is owed. Money recorded against it
    -- corrupts amount_paid, and every AR report reads that column.
    select i.status into v_status
      from public.rink_invoices i
     where i.id = new.invoice_id;

    if v_status = 'void' then
      raise exception 'rink_scheduling: cannot record a payment against a void invoice'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'rink_scheduling: payments are immutable — record a reversal instead'
      using errcode = '42501';
  elsif tg_op = 'DELETE' then
    raise exception 'rink_scheduling: payments cannot be deleted — record a reversal instead'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.rink_payments_guard() is
  'Money guard for rink_payments: append-only (no edits, no deletes) and no payment against a void invoice. Re-states at the trigger layer what RLS and the server actions already enforce, so direct SQL from a non-exempt owner session cannot corrupt amount_paid.';

-- The trigger previously covered UPDATE and DELETE only; INSERT is new.
drop trigger if exists trg_rink_payments_guard on public.rink_payments;
create trigger trg_rink_payments_guard
  before insert or update or delete on public.rink_payments
  for each row execute function public.rink_payments_guard();

commit;
