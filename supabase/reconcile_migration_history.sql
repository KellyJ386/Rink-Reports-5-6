-- =============================================================================
-- reconcile_migration_history.sql   (ONE-TIME, run manually)
--
-- WHY: supabase_migrations.schema_migrations on project bqbdgwlhbhabsibjgwmk
-- accumulated THREE overlapping series:
--   1. numeric 00000000000001..086 + a stray 088 (an early `db push`),
--   2. a 20260506..20260527 timestamp series (a later re-versioned push),
--   3. a 20260531 timestamp series (the MCP apply_migration calls from the
--      scale/hardening pass).
-- The repo is the source of truth: a clean monotonic set 001..099. Every one of
-- those migrations is ALREADY physically applied to the database; this script
-- only repairs the BOOKKEEPING so `supabase db push` becomes a clean no-op and
-- `supabase migration list` shows local == remote.
--
-- SAFE: touches only the migration-ledger table, not application data/schema.
-- Run it once via the Supabase SQL editor (or psql) for this project.
--
-- Equivalent CLI form: `supabase migration repair --status reverted <v>` for
-- every timestamp/stray version, then `--status applied <v>` for 087..099.
-- This single transaction does the same thing far more cheaply.
-- =============================================================================

begin;

delete from supabase_migrations.schema_migrations;

insert into supabase_migrations.schema_migrations (version, name) values
  ('00000000000001','extensions'),
  ('00000000000002','backbone_schema'),
  ('00000000000003','helper_functions'),
  ('00000000000004','backbone_rls'),
  ('00000000000005','seed_system_roles'),
  ('00000000000006','security_hardening'),
  ('00000000000007','daily_reports_schema'),
  ('00000000000008','incident_reports_schema'),
  ('00000000000009','communications_schema'),
  ('00000000000010','accident_reports_schema'),
  ('00000000000011','refrigeration_schema'),
  ('00000000000012','air_quality_schema'),
  ('00000000000013','ice_operations_schema'),
  ('00000000000014','ice_depth_schema'),
  ('00000000000015','scheduling_schema'),
  ('00000000000016','users_self_insert'),
  ('00000000000017','get_employee_counts_by_facility'),
  ('00000000000018','retention_settings'),
  ('00000000000019','export_settings'),
  ('00000000000020','shift_reminder_notification_type'),
  ('00000000000021','schedule_swap_requests_rls'),
  ('00000000000022','settings_cascade_delete'),
  ('00000000000023','performance_indexes'),
  ('00000000000024','retention_aware_purge_functions'),
  ('00000000000025','helper_function_null_guards'),
  ('00000000000026','revoke_anon_function_execute'),
  ('00000000000027','incident_status_in_review'),
  ('00000000000028','facility_contact_fields'),
  ('00000000000029','module_permission_helper'),
  ('00000000000030','submission_rls_module_permissions'),
  ('00000000000031','offline_sync_queue'),
  ('00000000000032','refrigeration_change_log'),
  ('00000000000033','air_quality_change_log'),
  ('00000000000034','ice_operations_change_log'),
  ('00000000000035','ice_depth_change_log'),
  ('00000000000036','export_settings_columns'),
  ('00000000000037','retention_last_purged_at'),
  ('00000000000038','permission_level_enum'),
  ('00000000000039','backfill_and_sync_trigger'),
  ('00000000000040','schedule_publish_requests'),
  ('00000000000041','audit_triggers'),
  ('00000000000042','employee_custom_fields'),
  ('00000000000043','dept_facility_permission_defaults'),
  ('00000000000044','roles_active_and_description'),
  ('00000000000045','notification_timing_and_outbox'),
  ('00000000000046','audit_triggers_expansion'),
  ('00000000000047','notification_outbox_drain'),
  ('00000000000048','pdf_attachments'),
  ('00000000000049','security_hardening'),
  ('00000000000050','deferred_security_followups'),
  ('00000000000051','accident_witnesses_and_age'),
  ('00000000000052','facility_city_state_email'),
  ('00000000000053','create_employee_complete'),
  ('00000000000054','module_area_permissions_rls_tighten'),
  ('00000000000055','consolidate_canonical_roles'),
  ('00000000000056','employee_invites'),
  ('00000000000057','employee_certifications'),
  ('00000000000058','drop_gm_from_admin_role_lists'),
  ('00000000000059','communication_groups_staff_can_message'),
  ('00000000000060','communication_recipient_delivery_state'),
  ('00000000000061','fix_phantom_table_names'),
  ('00000000000062','email_send_retry'),
  ('00000000000063','routing_requires_ack'),
  ('00000000000064','refrigeration_field_is_required'),
  ('00000000000065','employee_hidden_modules'),
  ('00000000000066','revoke_anon_security_definer_followups'),
  ('00000000000067','ice_depth_layout_logo'),
  ('00000000000068','group_member_facility_match'),
  ('00000000000069','create_facility_with_roles'),
  ('00000000000070','employee_custom_fields'),
  ('00000000000071','rls_use_effective_permission'),
  ('00000000000072','drop_custom_employee_fields'),
  ('00000000000073','simplify_permission_resolution'),
  ('00000000000074','accident_wrists_body_part'),
  ('00000000000075','ice_resurfacer_equipment_type'),
  ('00000000000076','ice_operations_fuel_types_and_templates'),
  ('00000000000077','user_permissions_replace'),
  ('00000000000078','user_permissions_rls_recursion_fix'),
  ('00000000000079','role_permission_defaults_and_source'),
  ('00000000000080','seed_role_permission_defaults_tennity'),
  ('00000000000081','apply_role_permission_defaults_fn'),
  ('00000000000082','role_permission_defaults_auto_seed'),
  ('00000000000083','ice_depth_rinks'),
  ('00000000000084','air_quality_form_data'),
  ('00000000000085','facility_documents'),
  ('00000000000086','dispatch_authz_gate_restore'),
  ('00000000000087','retire_gm_supervisor_roles'),
  ('00000000000088','information_requests'),
  ('00000000000089','circle_check_response_type'),
  ('00000000000090','daily_area_submit_enforcement'),
  ('00000000000091','unify_permission_helpers'),
  ('00000000000092','scaling_indexes'),
  ('00000000000093','accident_body_part_laterality'),
  ('00000000000094','rate_limit'),
  ('00000000000095','audit_identity_permissions'),
  ('00000000000096','facility_scaling_indexes'),
  ('00000000000097','security_hardening_v3'),
  ('00000000000098','consolidate_rls_policies'),
  ('00000000000099','drop_dead_legacy_permission_tables');

commit;
