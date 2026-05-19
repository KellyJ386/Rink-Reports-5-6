-- 00000000000072_drop_custom_employee_fields.sql
--
-- Removes the unused Custom Employee Fields feature. Production audit at
-- migration time showed 0 rows in both tables across all facilities, and
-- the /admin/employees/custom-fields UI has never been used in practice.
--
-- Dropped:
--   * public.employee_custom_field_values
--   * public.employee_custom_fields
-- The accompanying RLS policies, triggers, indexes, and audit triggers go
-- with the tables via CASCADE.

begin;

drop table if exists public.employee_custom_field_values cascade;
drop table if exists public.employee_custom_fields cascade;

commit;
