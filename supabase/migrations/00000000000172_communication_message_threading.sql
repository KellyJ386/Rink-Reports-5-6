-- =============================================================================
-- 00000000000172_communication_message_threading.sql
--
-- Reply support for communications. A reply is an ordinary
-- communication_messages row that records which message it responds to.
-- v1 only SETS the column (reply-to-sender from the staff inbox); rendering
-- full threads can build on it later without another schema change.
--
-- ON DELETE SET NULL: deleting a parent (admin moderation, retention purge)
-- must not cascade away the replies — they just become top-level messages.
-- No RLS change needed: replies ride the existing communication_messages
-- policies (sender-self INSERT with module access, facility-scoped SELECT).
-- =============================================================================

alter table public.communication_messages
  add column if not exists parent_message_id uuid null
    references public.communication_messages(id) on delete set null;

comment on column public.communication_messages.parent_message_id is
  'Message this one replies to; null for top-level messages. Set-null on parent delete.';

create index if not exists idx_communication_messages_parent
  on public.communication_messages (parent_message_id)
  where parent_message_id is not null;
