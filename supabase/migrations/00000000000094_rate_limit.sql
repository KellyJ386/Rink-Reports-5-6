-- =============================================================================
-- 00000000000092_rate_limit.sql
--
-- Postgres-backed IP rate limiting for the PUBLIC, unauthenticated lead form
-- (src/app/api/information-requests/route.ts). The anon key ships in the client
-- bundle, so anyone can POST directly; before this migration there was no
-- abuse protection (no Redis/KV in this stack).
--
-- The counters table is reachable ONLY through check_rate_limit() below — RLS
-- is ENABLED with NO policies, so neither anon nor authenticated can read or
-- write it directly. The SECURITY DEFINER function owns all access.
--
-- Style mirrors the existing SECURITY DEFINER helpers (migrations 3, 29, 41):
-- explicit `set search_path = public, pg_temp`, revoke from public, grant to
-- the exact roles that need it.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- rate_limit_counters
--
-- One row per (bucket, identifier, window_start). A "window" is a fixed
-- alignment computed by the function (floor(now / window_seconds)); within a
-- window the row's `hits` is incremented atomically via the upsert below.
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limit_counters (
  bucket        text        not null,
  identifier    text        not null,
  window_start  timestamptz not null,
  hits          integer     not null default 0,
  created_at    timestamptz not null default now(),
  constraint rate_limit_counters_pkey primary key (bucket, identifier, window_start)
);

comment on table public.rate_limit_counters is
  'Fixed-window rate-limit counters keyed by (bucket, identifier, window_start). '
  'Reachable ONLY through public.check_rate_limit(); RLS is enabled with no '
  'policies so direct anon/authenticated access is denied. Old rows (window_start '
  'in the past) are inert and may be purged by the retention sweep at any time '
  '(see purge_old_rate_limit_counters() below) — they do not affect correctness.';

-- Lets the retention sweep / pruning find expired windows cheaply.
create index if not exists rate_limit_counters_window_start_idx
  on public.rate_limit_counters (window_start);

-- RLS ENABLED, NO POLICIES: the table is unreachable except via the
-- SECURITY DEFINER function below, which runs as the table owner and so
-- bypasses RLS. This is the same "function-only access" shape used for the
-- audit_logs writes in migration 41.
alter table public.rate_limit_counters enable row level security;

-- -----------------------------------------------------------------------------
-- check_rate_limit(bucket, identifier, max, window_seconds) -> boolean
--
-- Atomically records one hit for the current fixed window and returns:
--   TRUE  -> request is ALLOWED (running count for the window <= p_max)
--   FALSE -> request is OVER the limit (count exceeded p_max)
--
-- The INSERT ... ON CONFLICT DO UPDATE is a single atomic statement, so
-- concurrent callers cannot race past the cap. The post-increment count is
-- returned by RETURNING and compared to p_max.
-- -----------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket         text,
  p_identifier     text,
  p_max            integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_hits         integer;
begin
  -- Defensive: a non-positive window or max would make the limiter meaningless.
  if p_window_seconds is null or p_window_seconds <= 0
     or p_max is null or p_max < 0
     or p_bucket is null or p_identifier is null then
    -- Fail open at the DB layer for clearly malformed input rather than
    -- erroring; the caller's own validation is the real gate.
    return true;
  end if;

  -- Align to a fixed window: all hits in the same [k*window, (k+1)*window)
  -- slice share one counter row.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_counters (bucket, identifier, window_start, hits)
  values (p_bucket, p_identifier, v_window_start, 1)
  on conflict (bucket, identifier, window_start)
  do update set hits = public.rate_limit_counters.hits + 1
  returning hits into v_hits;

  return v_hits <= p_max;
end;
$$;

comment on function public.check_rate_limit(text, text, integer, integer) is
  'Atomically counts one hit for (bucket, identifier) in the current fixed '
  'window of p_window_seconds. Returns true if the running count is <= p_max '
  '(allowed) or false if over the limit. Backs the public lead-form rate limit. '
  'Reads/writes public.rate_limit_counters as table owner (RLS-enabled, no policies).';

-- Only the function should touch the table; expose execute to the roles the
-- lead form runs as. The form uses the anon client, but authenticated users
-- hitting the same endpoint must also be limited.
revoke execute on function public.check_rate_limit(text, text, integer, integer) from public;
grant  execute on function public.check_rate_limit(text, text, integer, integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- purge_old_rate_limit_counters()
--
-- Self-pruning helper. Old windows are inert (check_rate_limit only ever reads
-- the current window), but the table will grow without bound otherwise. Mirror
-- the service-role-only purge functions from migration 24: revoke from anon and
-- authenticated; the retention cron / service role calls it.
-- -----------------------------------------------------------------------------
create or replace function public.purge_old_rate_limit_counters()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  -- Anything older than a day is far past any window we use (largest window is
  -- 10 minutes for the lead form). Keep a generous margin.
  delete from public.rate_limit_counters
  where window_start < (clock_timestamp() - interval '1 day');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_old_rate_limit_counters() is
  'Deletes rate_limit_counters rows whose window closed more than a day ago. '
  'Service-role only; intended to run from the retention sweep.';

revoke execute on function public.purge_old_rate_limit_counters() from public, anon, authenticated;

commit;
