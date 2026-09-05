-- =============================================================================
-- 00000000000278_hash_schedule_ics_tokens_at_rest.sql
--
-- Stop storing the ICS calendar-feed credential in the clear. The token inside
-- an employee's personal /api/schedule-ics/<token> URL is a bearer secret
-- (calendar apps cannot authenticate), but schedule_ics_tokens (migration 168)
-- kept it as plaintext — anyone with a database read (a leaked backup, a
-- service-role console session) could reconstruct every employee's live feed
-- URL. rink-scheduling's display tokens already store only a sha256
-- (rink_display_tokens, token_hash); this brings the ICS feed to the same bar.
--
-- Mechanics:
--   * `token` is RENAMED to `token_hash` (the pkey/unique/check constraints
--     keep their stored names and now reference the new column).
--   * Every existing row is backfilled IN PLACE with the hex sha256 of its
--     plaintext — encode(sha256(convert_to(...,'UTF8')),'hex') — which is
--     byte-identical to the Node side's
--     createHash('sha256').update(token,'utf8').digest('hex')
--     (see src/app/reports/scheduling/_lib/ics-token.ts and its pinned-vector
--     unit test). Feed URLs already pasted into calendar apps therefore KEEP
--     WORKING: the route hashes the presented token and matches on token_hash.
--   * 64 hex chars satisfies the existing length >= 32 CHECK; uniqueness is
--     preserved (sha256 of distinct random tokens).
--
-- App-side consequence (same PR): the plaintext is now shown exactly once, in
-- the create/rotate action result. My Schedule can only report whether a feed
-- exists; a lost URL is recovered by rotating, which 404s the old link.
-- =============================================================================

alter table public.schedule_ics_tokens rename column token to token_hash;

update public.schedule_ics_tokens
   set token_hash = encode(sha256(convert_to(token_hash, 'UTF8')), 'hex');

comment on table public.schedule_ics_tokens is
  'One secret per employee for the public ICS calendar-feed route. The unguessable token in the subscription URL is the credential (calendar apps cannot authenticate); since migration 278 only its sha256 hex digest is stored (token_hash), so a database read cannot reconstruct a feed URL. Owner-only RLS; the feed route hashes the presented token and reads via service role. Rotating (upsert of a new hash) invalidates old subscription URLs.';
