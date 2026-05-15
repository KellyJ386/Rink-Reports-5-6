-- =============================================================================
-- 00000000000059_communication_groups_staff_can_message.sql
--
-- Spec carve-out: non-admin staff may only send messages to groups explicitly
-- flagged as staff-visible (typically "managers", "supervisors", or similar
-- escalation groups). Admins still see every active group.
--
-- The prior behaviour allowed staff with `communications.can_submit` to send
-- to ANY active group in their facility, which violated the original product
-- spec ("staff can message managers/supervisors only"). The compose page
-- carried a TODO comment about this; this migration closes that gap.
--
-- Enforcement layers:
--   1. New column `staff_can_message` (default false).
--   2. Compose UI filters to staff-visible groups for non-admins.
--   3. Server action validates the same on submit (defence-in-depth).
--   4. RLS test in supabase/tests/rls_isolation.sql covers the column.
--
-- Existing groups default to false so administrators must opt them in
-- explicitly via the admin UI / a follow-up data migration. This is the
-- safer side of the fence: a forgotten group surfaces as "no recipients",
-- not as accidental over-sharing.
-- =============================================================================

alter table public.communication_groups
  add column if not exists staff_can_message boolean not null default false;

comment on column public.communication_groups.staff_can_message is
  'When true, non-admin staff with communications.can_submit may target this '
  'group from /reports/communications/compose. Admins are not gated by this '
  'flag. Default false so existing groups must be opted in explicitly.';

create index if not exists idx_communication_groups_staff_can_message
  on public.communication_groups (facility_id, staff_can_message)
  where staff_can_message = true;
