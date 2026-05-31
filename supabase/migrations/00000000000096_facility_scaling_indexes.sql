-- =============================================================================
-- 00000000000096_facility_scaling_indexes.sql
--
-- Tenant-scoping indexes. Every facility-scoped table is filtered by
-- facility_id = current_facility_id() under RLS. These 21 tables had a
-- facility_id column but no index leading with it, so each per-tenant scan
-- was a sequential scan -- fine at 1 facility, a cliff at 1000. Adding the
-- single-column facility_id index lets the planner seek per tenant.
--
-- (communication_recipients and audit_logs were already covered by
-- 00000000000092_scaling_indexes.sql.)
-- =============================================================================

create index if not exists idx_accident_body_part_selections_facility_id on public.accident_body_part_selections (facility_id);
create index if not exists idx_accident_change_log_facility_id on public.accident_change_log (facility_id);
create index if not exists idx_accident_followup_notes_facility_id on public.accident_followup_notes (facility_id);
create index if not exists idx_accident_witnesses_facility_id on public.accident_witnesses (facility_id);
create index if not exists idx_air_quality_followup_notes_facility_id on public.air_quality_followup_notes (facility_id);
create index if not exists idx_air_quality_readings_facility_id on public.air_quality_readings (facility_id);
create index if not exists idx_communication_group_members_facility_id on public.communication_group_members (facility_id);
create index if not exists idx_daily_report_submission_items_facility_id on public.daily_report_submission_items (facility_id);
create index if not exists idx_ice_depth_followup_notes_facility_id on public.ice_depth_followup_notes (facility_id);
create index if not exists idx_ice_depth_measurements_facility_id on public.ice_depth_measurements (facility_id);
create index if not exists idx_ice_depth_points_facility_id on public.ice_depth_points (facility_id);
create index if not exists idx_ice_operations_circle_check_results_facility_id on public.ice_operations_circle_check_results (facility_id);
create index if not exists idx_ice_operations_circle_check_template_items_facility_id on public.ice_operations_circle_check_template_items (facility_id);
create index if not exists idx_ice_operations_followup_notes_facility_id on public.ice_operations_followup_notes (facility_id);
create index if not exists idx_refrigeration_followup_notes_facility_id on public.refrigeration_followup_notes (facility_id);
create index if not exists idx_refrigeration_report_values_facility_id on public.refrigeration_report_values (facility_id);
create index if not exists idx_schedule_availability_facility_id on public.schedule_availability (facility_id);
create index if not exists idx_schedule_notifications_facility_id on public.schedule_notifications (facility_id);
create index if not exists idx_schedule_open_shifts_facility_id on public.schedule_open_shifts (facility_id);
create index if not exists idx_schedule_swap_requests_facility_id on public.schedule_swap_requests (facility_id);
create index if not exists idx_schedule_template_shifts_facility_id on public.schedule_template_shifts (facility_id);
