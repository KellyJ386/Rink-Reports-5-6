-- =============================================================================
-- 00000000000028_auth_user_trigger.sql
--
-- Create a public.users profile row automatically whenever a new auth.users
-- row is inserted. Runs SECURITY DEFINER so it bypasses RLS — this is
-- required because new users have no session yet when email confirmation is
-- enabled (signUp returns a user but no JWT, so the anon-key client cannot
-- satisfy any authenticated INSERT policy).
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger: auto-creates a public.users profile when an auth.users row is inserted.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
