-- =============================================================================
-- 00000000000016_users_self_insert.sql
-- Allow newly signed-up users to insert their own public.users row when no
-- profile exists yet. The signup server action upserts into public.users right
-- after auth.users is created; without this policy the upsert is rejected by
-- RLS (the existing users_insert policy only permits admins/super_admins).
--
-- Constraints:
--   * id MUST equal auth.uid() — users can only create their own profile
--   * facility_id MUST be NULL — assignment to a facility happens via admin UI
--   * is_super_admin MUST be false — privilege escalation prevented
-- =============================================================================

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
  for insert to authenticated
  with check (
    id = auth.uid()
    and facility_id is null
    and is_super_admin = false
  );
