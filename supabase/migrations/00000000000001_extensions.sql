-- =============================================================================
-- 00000000000001_extensions.sql
-- Enable required Postgres extensions for the MFO / Rink Reports backbone.
-- =============================================================================

-- pgcrypto provides gen_random_uuid() for UUID primary keys.
create extension if not exists "pgcrypto";

-- citext provides case-insensitive text (used for emails).
create extension if not exists "citext";

-- pg_trgm enables trigram indexes for fuzzy / ILIKE search performance.
create extension if not exists "pg_trgm";
