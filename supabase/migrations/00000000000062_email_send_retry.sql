-- =============================================================================
-- 00000000000062_email_send_retry.sql
--
-- Adds attempt tracking + backoff scheduling to the email send pipeline.
--
-- Before this migration, the send-communications cron route had two terminal
-- states: 'sent' or 'failed'. Now that email_attachments ship via Resend,
-- transient failures (rate limits, network blips, temporary domain
-- throttling) are real and they leave recipients permanently in 'failed'
-- with no recovery path short of a manual UPDATE.
--
-- New columns:
--   email_attempts          int          how many sends have been tried
--   email_next_attempt_at   timestamptz  earliest time the cron may retry
--
-- Worker contract (src/app/api/cron/send-communications):
--   * Selects email_status='pending' AND
--     (email_next_attempt_at IS NULL OR email_next_attempt_at <= now()).
--   * On transient failure: increment attempts, leave status='pending',
--     stamp email_next_attempt_at = now() + backoff(attempts).
--   * On terminal failure (attempts >= MAX_EMAIL_ATTEMPTS): set
--     email_status='failed' so it's surfaced in admin UI and stops retrying.
--   * On success: email_status='sent' (terminal).
--
-- The existing partial index
-- (idx_communication_recipients_email_pending, migration 60) is dropped and
-- replaced with one that also constrains on email_next_attempt_at so the
-- worker's ready-now query stays cheap as the backoff queue grows.
-- =============================================================================

alter table public.communication_recipients
  add column if not exists email_attempts        int         not null default 0,
  add column if not exists email_next_attempt_at timestamptz;

comment on column public.communication_recipients.email_attempts is
  'How many send attempts have been made. Resets implicitly when a row is '
  're-inserted (we never UPDATE this back to 0).';

comment on column public.communication_recipients.email_next_attempt_at is
  'Earliest UTC time at which the send-communications cron may retry this '
  'row. NULL means "ready now". Set by the cron worker after a transient '
  'failure; cleared implicitly on success/terminal failure since the row '
  'leaves email_status=pending.';

-- Replace the migration-60 partial index with one that also covers the
-- backoff predicate. Worker query is:
--   WHERE email_status='pending'
--     AND (email_next_attempt_at IS NULL OR email_next_attempt_at <= now())
--   ORDER BY created_at ASC
-- The IS NULL OR <= now() shape doesn't directly use a single index entry,
-- but indexing (email_next_attempt_at, created_at) NULLS FIRST gives the
-- planner an ordered seek for both the ready-now rows and the
-- already-scheduled future ones.
drop index if exists public.idx_communication_recipients_email_pending;

create index if not exists idx_communication_recipients_email_ready
  on public.communication_recipients (email_next_attempt_at nulls first, created_at asc)
  where email_status = 'pending';
