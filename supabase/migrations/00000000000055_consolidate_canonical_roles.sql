-- 00000000000055_consolidate_canonical_roles.sql
--
-- Collapses the 6 canonical roles to 4. The previous set was:
--   super_admin, admin, gm, manager, supervisor, staff
-- The new canonical set is:
--   super_admin (0), admin (1), manager (2), staff (3)
--
-- Existing employees on the dropped roles are reassigned:
--   * gm        -> admin
--   * supervisor-> manager
--
-- Role rows themselves are then removed per facility. Any
-- role_module_permission_defaults rows pointing at the dropped roles go
-- with the role row via cascade (FK on role_id is ON DELETE CASCADE per
-- migration 38).

begin;

-- Reassign employees: gm -> admin
update public.employees e
set role_id = target.id
from public.roles src
join public.roles target
  on target.facility_id = src.facility_id
 and target.key = 'admin'
where e.role_id = src.id
  and src.key = 'gm';

-- Reassign employees: supervisor -> manager
update public.employees e
set role_id = target.id
from public.roles src
join public.roles target
  on target.facility_id = src.facility_id
 and target.key = 'manager'
where e.role_id = src.id
  and src.key = 'supervisor';

-- Drop the obsolete role rows. Any employee_departments or
-- module_permissions rows are employee-keyed and untouched.
delete from public.roles where key in ('gm', 'supervisor');

-- Bring the manager hierarchy_level into line with the new 4-role set so
-- ordering queries match the seed. (super_admin=0, admin=1, manager=2,
-- staff=3.)
update public.roles set hierarchy_level = 2 where key = 'manager';
update public.roles set hierarchy_level = 3 where key = 'staff';

commit;
