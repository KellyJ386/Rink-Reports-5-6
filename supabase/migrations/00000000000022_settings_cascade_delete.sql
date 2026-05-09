-- Changes retention_settings and export_settings facility_id FK from
-- ON DELETE RESTRICT to ON DELETE CASCADE so that deleting a facility
-- automatically removes its orphaned settings rows.

alter table public.retention_settings
  drop constraint retention_settings_facility_id_fkey,
  add constraint retention_settings_facility_id_fkey
    foreign key (facility_id)
    references public.facilities(id)
    on delete cascade;

alter table public.export_settings
  drop constraint export_settings_facility_id_fkey,
  add constraint export_settings_facility_id_fkey
    foreign key (facility_id)
    references public.facilities(id)
    on delete cascade;
