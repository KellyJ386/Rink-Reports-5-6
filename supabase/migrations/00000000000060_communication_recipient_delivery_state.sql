-- =============================================================================
-- 00000000000060_communication_recipient_delivery_state.sql
--
-- External delivery tracking on communication_recipients.
--
-- Until now `drain_notification_outbox()` promoted outbox rows into
-- `communication_messages` + `communication_recipients`, and that was the
-- end of the chain — the system was in-app only (see migration 9 comment).
-- This migration adds per-channel delivery state so an external worker
-- (Resend for email, Twilio for SMS) can pick up pending recipients, send,
-- and record success/failure idempotently.
--
-- Channels are independent: email_status and sms_status advance separately
-- so a recipient with no phone number resolves to email-sent + sms-skipped
-- without blocking the row.
--
-- Status lifecycle (per channel):
--   pending  → worker has not attempted to send yet
--   sent     → external provider accepted the message
--   failed   → external provider rejected; error captured in *_error
--   skipped  → no contact field for this channel (e.g. no phone number),
--              or provider not configured. Terminal; not retried.
--
-- Existing rows backfill to 'pending' for both channels. The send worker
-- (see src/app/api/cron/send-communications) advances rows; failing to
-- configure RESEND_API_KEY / TWILIO_* env vars leaves rows in 'pending'
-- so they retry once secrets are provisioned.
-- =============================================================================

alter table public.communication_recipients
  add column if not exists email_status   text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  add column if not exists email_sent_at  timestamptz,
  add column if not exists email_error    text,
  add column if not exists sms_status     text not null default 'pending'
    check (sms_status in ('pending', 'sent', 'failed', 'skipped')),
  add column if not exists sms_sent_at    timestamptz,
  add column if not exists sms_error      text;

comment on column public.communication_recipients.email_status is
  'External email delivery state. pending → sent/failed/skipped. Advanced '
  'only by the cron worker (src/app/api/cron/send-communications), never '
  'by the user.';

comment on column public.communication_recipients.sms_status is
  'External SMS delivery state. Same lifecycle as email_status. '
  '''skipped'' when the recipient has no phone or Twilio is unconfigured.';

-- Partial index so the worker can cheaply find pending work without a full
-- scan of the recipients table.
create index if not exists idx_communication_recipients_email_pending
  on public.communication_recipients (created_at asc)
  where email_status = 'pending';

create index if not exists idx_communication_recipients_sms_pending
  on public.communication_recipients (created_at asc)
  where sms_status = 'pending';
