-- Add an in-flight email delivery state so the communications cron can claim
-- recipient rows before calling the external email provider. This closes the
-- race where overlapping cron invocations could both send the same pending row
-- and only discover the conflict when updating state after the side effect.
--
-- A claimed row uses:
--   email_status = 'sending'
--   email_next_attempt_at = claim expiry timestamp
--
-- If a worker dies mid-send, a later cron run may reclaim the row after the
-- expiry and retry it. Successful/failed sends still clear or reset
-- email_next_attempt_at as before.

alter table public.communication_recipients
  drop constraint if exists communication_recipients_email_status_check;

alter table public.communication_recipients
  add constraint communication_recipients_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

comment on column public.communication_recipients.email_status is
  'External email delivery state. pending = ready or waiting for retry; sending = claimed by a cron worker until email_next_attempt_at; sent/failed/skipped are terminal.';

drop index if exists public.idx_communication_recipients_email_ready;

create index if not exists idx_communication_recipients_email_ready
  on public.communication_recipients (email_status, email_next_attempt_at nulls first, created_at asc)
  where email_status in ('pending', 'sending');
