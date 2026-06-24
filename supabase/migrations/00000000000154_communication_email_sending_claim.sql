-- Add an in-flight email delivery state so the communications cron can claim
-- recipient rows before calling the external email provider. This closes the
-- race where overlapping cron invocations could both send the same pending row
-- and only discover the conflict when updating state after the side effect.
--
-- A claimed row uses:
--   email_status = 'sending'
--   email_claim_token = random worker-local UUID
--   email_next_attempt_at = claim expiry timestamp
--
-- If a worker dies mid-send, a later cron run may reclaim the row after the
-- expiry and retry it. The claim token prevents an expired worker from
-- settling a row after another worker has reclaimed it. Successful/failed
-- sends clear the claim token and clear or reset email_next_attempt_at.

alter table public.communication_recipients
  add column if not exists email_claim_token uuid;

alter table public.communication_recipients
  drop constraint if exists communication_recipients_email_status_check;

alter table public.communication_recipients
  add constraint communication_recipients_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

comment on column public.communication_recipients.email_status is
  'External email delivery state. pending = ready or waiting for retry; sending = claimed by a cron worker until email_next_attempt_at; sent/failed/skipped are terminal.';

comment on column public.communication_recipients.email_claim_token is
  'Random UUID written by the cron worker when claiming a row for email delivery. Settlement updates must match this token so stale workers cannot overwrite newer claims.';

drop index if exists public.idx_communication_recipients_email_ready;

create index if not exists idx_communication_recipients_email_ready
  on public.communication_recipients (email_status, email_next_attempt_at nulls first, created_at asc)
  where email_status in ('pending', 'sending');
