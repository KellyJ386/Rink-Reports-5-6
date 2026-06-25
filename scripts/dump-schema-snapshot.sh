#!/usr/bin/env bash
# =============================================================================
# dump-schema-snapshot.sh
#
# Emits a deterministic, normalized DDL snapshot of the `public` schema to
# stdout. Used as a DRIFT ORACLE: CI rebuilds a throwaway Postgres purely from
# supabase/migrations/**, dumps the schema with this script, and diffs it
# against the committed supabase/schema.snapshot.sql. Any unexpected change to
# the schema the migrations PRODUCE (including an edited historical migration)
# shows up as a diff and fails the PR.
#
# It is hermetic by design — it reflects what the repo's migration files build,
# not what any live project happens to contain, so it does not depend on a
# database's recorded migration history (which on this project is markers with
# empty `statements`, useless as a drift oracle).
#
# Usage:
#   ./scripts/dump-schema-snapshot.sh <postgres-connection-url> > supabase/schema.snapshot.sql
#
# Regenerate locally after an intentional schema change:
#   supabase start
#   ./scripts/dump-schema-snapshot.sh \
#     "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
#     > supabase/schema.snapshot.sql
# =============================================================================
set -euo pipefail

PGURL="${1:?usage: dump-schema-snapshot.sh <postgres-connection-url>}"

# --schema=public            : the app's object surface (tables, functions,
#                              policies, triggers, types) the migrations own.
# --no-owner / --no-privileges: roles differ between local/CI/prod; ignore them.
# Normalization keeps the dump stable across pg_dump/server patch bumps:
#   * drop the "-- Dumped from/by ... version X" header lines (version strings),
#   * drop leading SET / set_config noise,
#   * trim trailing whitespace.
# Section header comments and object DDL are retained so a drift diff is
# human-readable and points at the changed object.
pg_dump "$PGURL" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema=public \
  | grep -vE '^-- Dumped (from|by) ' \
  | grep -vE '^(SET |SELECT pg_catalog\.set_config)' \
  | sed -e 's/[[:space:]]*$//'
