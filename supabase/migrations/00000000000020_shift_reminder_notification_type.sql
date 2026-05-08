-- =============================================================================
-- 00000000000020_shift_reminder_notification_type.sql
-- Adds 'shift_reminder' to the schedule_notifications notification_type check.
-- =============================================================================

alter table public.schedule_notifications
  drop constraint if exists schedule_notifications_notification_type_check;

alter table public.schedule_notifications
  add constraint schedule_notifications_notification_type_check
  check (notification_type in (
    'schedule_published',
    'shift_changed',
    'open_shift_available',
    'swap_request_received',
    'swap_approved',
    'swap_denied',
    'time_off_decided',
    'overtime_warning',
    'shift_reminder'
  ));
